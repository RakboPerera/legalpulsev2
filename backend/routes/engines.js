import { Router } from 'express';
import { getWorkspace, saveWorkspace, withWorkspaceLock } from '../lib/workspaceStore.js';
import { addAuditEntry } from '../lib/audit.js';
import { runCrossSellEngine } from '../engines/crossSell.js';
import { runProspectDiscoveryEngine } from '../engines/prospectDiscovery.js';
import { runEventIntelligenceEngine } from '../engines/eventIntelligence.js';
import { requireAuth } from './auth.js';
import { llmRateLimit } from '../lib/rateLimit.js';
import { gateOpportunity } from '../lib/opportunityPipeline.js';

function makeEngineHandler(db, { engineFn, oppType, auditActor }) {
  return async (req, res) => {
    if (!req.user.providerApiKey) {
      return res.status(400).json({
        error: 'no_llm_key_configured',
        message: 'Configure your LLM provider key in Settings → API Keys before running engines.'
      });
    }
    let out;
    try {
      out = await withWorkspaceLock(req.params.id, async () => {
        const ws = getWorkspace(db, req.params.id, req.user.id);
        if (!ws) return { status: 404, body: { error: 'not found' } };
        const raw = await engineFn({
          workspace: ws,
          apiKey: req.user.providerApiKey,
          provider: req.user.llmProvider
        });

        // Quality gate — same sanctions pre-filter + methodology critic the
        // bake script applies. Without this, the runtime engine routes were
        // producing opps that the bake would have dropped (sanctions-only
        // evidence, blocker-severity methodology issues).
        const gated = [];
        let dropped = 0, demoted = 0;
        for (const opp of raw) {
          const signals = (ws.signals || []).filter(s => (opp.basis?.signalIds || []).includes(s.id));
          const entity = (ws.clients || []).find(c => c.id === opp.entity)
            || (ws.prospects || []).find(p => p.id === opp.entity);
          // Thread the user's BYOK credentials so the critic ACTUALLY runs.
          // Without these args the critic call silently no-ops and opps
          // pass through ungated — the bug that audit finding 1.1 caught.
          const gatedOpp = await gateOpportunity(opp, {
            signals, entity,
            apiKey: req.user.providerApiKey,
            provider: req.user.llmProvider
          });
          if (!gatedOpp) { dropped++; continue; }
          if (gatedOpp !== opp) demoted++;
          gated.push(gatedOpp);
        }

        mergeOpportunities(ws, gated, oppType);
        addAuditEntry(ws, {
          type: 'engine_run',
          actor: auditActor,
          outputs: { generated: gated.length, dropped, demoted, raw: raw.length }
        });
        saveWorkspace(db, ws);
        return { status: 200, body: { opportunities: gated, dropped, demoted } };
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(out.status).json(out.body);
  };
}

export function createEnginesRouter(db) {
  const router = Router();

  router.post('/:id/engines/cross-sell/run', requireAuth, llmRateLimit, makeEngineHandler(db, {
    engineFn: runCrossSellEngine,
    oppType: 'cross_sell',
    auditActor: 'cross_sell_engine'
  }));

  router.post('/:id/engines/prospect-discovery/run', requireAuth, llmRateLimit, makeEngineHandler(db, {
    engineFn: runProspectDiscoveryEngine,
    oppType: 'prospect',
    auditActor: 'prospect_discovery_engine'
  }));

  router.post('/:id/engines/event-intelligence/run', requireAuth, llmRateLimit, makeEngineHandler(db, {
    engineFn: runEventIntelligenceEngine,
    oppType: 'event_driven',
    auditActor: 'event_intelligence_engine'
  }));

  router.get('/:id/engines/status', requireAuth, (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    const counts = {
      cross_sell: (ws.opportunities || []).filter(o => o.type === 'cross_sell').length,
      prospect: (ws.opportunities || []).filter(o => o.type === 'prospect').length,
      event_driven: (ws.opportunities || []).filter(o => o.type === 'event_driven').length
    };
    res.json({ counts, lastRun: ws.bakedAt });
  });

  return router;
}

function mergeOpportunities(ws, incoming, type) {
  ws.opportunities = ws.opportunities || [];
  const existing = new Map(ws.opportunities.map(o => [o.id, o]));
  for (const o of incoming) {
    existing.set(o.id, { ...existing.get(o.id), ...o, type });
  }
  ws.opportunities = Array.from(existing.values());
}
