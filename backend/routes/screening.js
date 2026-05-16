// Market screening routes — power the Outreach > Market Screening tab.
//
// GET /workspaces/:id/screening/events?region=&industry=&since=&limit=
//   Returns event clusters from the workspace signal pool. No LLM cost.
//   Filters apply on signal jurisdictions, affectedIndustries, publishedAt.
//
// POST /workspaces/:id/screening/events/:eventKey/generate
//   Runs the marketScreeningAgent against a chosen event. Persists any
//   resulting opportunities (engineSource: 'market_screening') and any new
//   prospects (discoverySource: 'market_screening') to the workspace, so
//   the existing per-opp chat route works unchanged.
//
// DELETE /workspaces/:id/screening/clear
//   Drops every opp with engineSource 'market_screening' and every prospect
//   with discoverySource 'market_screening' from the workspace. Manual reset.

import { Router } from 'express';
import { getWorkspace, saveWorkspace, withWorkspaceLock } from '../lib/workspaceStore.js';
import { addAuditEntry } from '../lib/audit.js';
import { extractScreeningEvents, getEventSignals } from '../lib/eventClusters.js';
import { generateOppsFromEvent } from '../agents/marketScreeningAgent.js';
import { runEventChatAgent } from '../agents/eventChatAgent.js';
import { opportunityId } from '../lib/ids.js';
import { requireAuth } from './auth.js';
import { isString, badRequest } from '../lib/validate.js';
import { llmRateLimit } from '../lib/rateLimit.js';

const ALLOWED_REGIONS = new Set(['all', 'USA', 'UK', 'EU', 'Other']);
const ALLOWED_TIME_BANDS = { '24h': 86400000, '7d': 7 * 86400000, '30d': 30 * 86400000, 'all': null };

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

export function createScreeningRouter(db) {
  const router = Router();

  // GET event clusters with filters.
  router.get('/:id/screening/events', requireAuth, (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });

    const region = isString(req.query.region) && ALLOWED_REGIONS.has(req.query.region) ? req.query.region : 'all';
    const industry = isString(req.query.industry) ? req.query.industry : 'all';
    const timeBand = isString(req.query.since) && req.query.since in ALLOWED_TIME_BANDS ? req.query.since : '7d';
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);

    const sinceMs = ALLOWED_TIME_BANDS[timeBand];
    const sinceISO = sinceMs == null ? null : new Date(Date.now() - sinceMs).toISOString();

    const events = extractScreeningEvents(ws.signals || [], { region, industry, sinceISO, limit });

    // Annotate which events already have generated opps so the UI can
    // show "N opportunities generated" badges.
    const generatedByEvent = {};
    for (const o of (ws.opportunities || [])) {
      if (o.engineSource !== 'market_screening') continue;
      const key = o.basis?.eventClusterKey;
      if (!key) continue;
      generatedByEvent[key] = (generatedByEvent[key] || 0) + 1;
    }
    const annotated = events.map(e => ({
      ...e,
      generatedOppCount: generatedByEvent[e.eventKey] || 0
    }));

    res.json({
      events: annotated,
      total: events.length,
      filters: { region, industry, timeBand }
    });
  });

  // POST: generate opps from a chosen event (LLM call).
  router.post('/:id/screening/events/:eventKey/generate', requireAuth, llmRateLimit, async (req, res) => {
    if (!req.user.providerApiKey) {
      return res.status(400).json({
        error: 'no_llm_key_configured',
        message: 'Configure your LLM provider key in Settings → API Keys before generating screening opps.'
      });
    }

    // Read workspace OUTSIDE the lock (slow LLM call), then persist inside.
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });

    const eventKey = req.params.eventKey;
    const events = extractScreeningEvents(ws.signals || [], { limit: 200 });
    const event = events.find(e => e.eventKey === eventKey);
    if (!event) return res.status(404).json({ error: 'event cluster not found — re-run screening events query' });

    const signals = getEventSignals(ws.signals, eventKey);
    if (!signals.length) return res.status(400).json({ error: 'no signals in event cluster' });

    let result;
    try {
      result = await generateOppsFromEvent({
        event, signals, workspace: ws,
        apiKey: req.user.providerApiKey,
        provider: req.user.llmProvider
      });
    } catch (err) {
      console.error('[screening:generate] FAIL:', err);
      return res.status(500).json({ error: err.message || String(err) });
    }

    // Persist new prospects + opportunities under the lock.
    const persisted = [];
    await withWorkspaceLock(req.params.id, async () => {
      const ws2 = getWorkspace(db, req.params.id, req.user.id);
      if (!ws2) return;
      const now = new Date().toISOString();

      for (const opp of result.opportunities) {
        // Resolve entity reference: existing or new prospect.
        let entityId;
        if (opp.entityRef.existingId) {
          entityId = opp.entityRef.existingId;
        } else if (opp.entityRef.newProspect) {
          const np = opp.entityRef.newProspect;
          // Stable ID across re-clicks of the same event so we don't
          // create duplicate prospect records.
          const newId = `pr-screen-${slugify(np.legalName)}`;
          const existing = (ws2.prospects || []).find(p => p.id === newId)
            || (ws2.clients || []).find(c => c.id === newId);
          if (!existing) {
            ws2.prospects = ws2.prospects || [];
            ws2.prospects.push({
              id: newId,
              legalName: np.legalName,
              knownAliases: np.knownAliases || [],
              sector: np.sector,
              hqJurisdiction: np.hqJurisdiction,
              countriesOfOperation: [],
              size: 'unknown',
              externalIdentifiers: {},
              decisionMakers: [],
              discoverySource: 'market_screening',
              discoveryEventKey: eventKey,
              discoveryRationale: np.discoveryRationale || '',
              fitScore: opp.confidence || 0.6
            });
          }
          entityId = newId;
        } else {
          continue; // malformed
        }

        // Deterministic opp ID — stable across re-generates of the same event.
        const oppId = opportunityId('market_screening', entityId, opp.service, [eventKey]);
        // De-dupe: skip if this exact opp already exists.
        if ((ws2.opportunities || []).some(o => o.id === oppId)) continue;

        const persistedOpp = {
          id: oppId,
          type: 'market_screening',
          engineSource: 'market_screening',
          entity: entityId,
          entityType: opp.entityRef.newProspect ? 'prospect' : (entityId.startsWith('c-') ? 'client' : 'prospect'),
          suggestedService: opp.service,
          urgencyTier: opp.urgency || 'this_week',
          confidence: opp.confidence,
          score: opp.score,
          competitiveContext: 'open',
          generatedAt: now,
          status: 'new',
          statusHistory: [{ status: 'new', changedBy: 'market_screening_agent', changedAt: now }],
          notes: 'Generated from market-screening event. Review for solicitation compliance before outreach.',
          basis: {
            summary: opp.summary,
            reasoning: opp.reasoning,
            signalIds: signals.map(s => s.id),
            matterReferences: [],
            eventClusterKey: eventKey,
            eventInterpretation: result.eventInterpretation
          }
        };
        ws2.opportunities = ws2.opportunities || [];
        ws2.opportunities.push(persistedOpp);
        persisted.push(persistedOpp);
      }

      addAuditEntry(ws2, {
        type: 'engine_run',
        actor: 'market_screening_agent',
        inputs: { eventKey, signalCount: signals.length },
        outputs: { generated: persisted.length, eventInterpretation: result.eventInterpretation }
      });
      saveWorkspace(db, ws2);
    });

    res.json({
      eventInterpretation: result.eventInterpretation,
      opportunities: persisted,
      eventKey
    });
  });

  // POST per-event chat. The agent has access to the event cluster's
  // signals, the workspace roster, and two tools: tavily_search (live web
  // search for fresh context) + identify_opportunities (run the screener
  // for this event). Multi-turn tool use is bounded inside the agent.
  router.post('/:id/screening/events/:eventKey/chat', requireAuth, llmRateLimit, async (req, res) => {
    const message = req.body?.message;
    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-10) : [];
    if (!isString(message, { max: 4000 })) return badRequest(res, 'message required (1-4000 chars)');
    if (!req.user.providerApiKey) {
      return res.status(400).json({
        error: 'no_llm_key_configured',
        message: 'Configure your LLM provider key in Settings → API Keys to use event chat.'
      });
    }
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });

    const eventKey = req.params.eventKey;
    const events = extractScreeningEvents(ws.signals || [], { limit: 200 });
    const event = events.find(e => e.eventKey === eventKey);
    if (!event) return res.status(404).json({ error: 'event cluster not found' });
    const signals = getEventSignals(ws.signals, eventKey);

    try {
      const result = await runEventChatAgent({
        event, signals, workspace: ws, message, history,
        apiKey: req.user.providerApiKey,
        provider: req.user.llmProvider
      });
      // Audit-log the turn but don't persist transcript (chat is session-scoped).
      await withWorkspaceLock(req.params.id, async () => {
        const ws2 = getWorkspace(db, req.params.id, req.user.id);
        if (!ws2) return;
        addAuditEntry(ws2, {
          type: 'user_action',
          actor: 'event_chat_agent',
          inputs: { eventKey, message: message.slice(0, 200) },
          outputs: {
            reply: result.content?.slice(0, 200),
            toolsUsed: (result.toolsUsed || []).map(t => t.tool),
            generatedOppCount: result.generatedOpps?.opportunities?.length || 0
          }
        });
        saveWorkspace(db, ws2);
      });
      res.json({
        message: {
          role: 'assistant',
          content: result.content,
          toolsUsed: result.toolsUsed || [],
          generatedOpps: result.generatedOpps || null,
          timestamp: new Date().toISOString()
        }
      });
    } catch (err) {
      console.error('[event-chat] FAIL:', err);
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  // DELETE all market-screening opps + their discovered prospects.
  router.delete('/:id/screening/clear', requireAuth, async (req, res) => {
    await withWorkspaceLock(req.params.id, async () => {
      const ws = getWorkspace(db, req.params.id, req.user.id);
      if (!ws) return res.status(404).json({ error: 'not found' });
      const beforeOpps = (ws.opportunities || []).length;
      const beforeProspects = (ws.prospects || []).length;
      ws.opportunities = (ws.opportunities || []).filter(o => o.engineSource !== 'market_screening');
      ws.prospects = (ws.prospects || []).filter(p => p.discoverySource !== 'market_screening');
      addAuditEntry(ws, {
        type: 'user_action',
        actor: req.user.email,
        inputs: { action: 'clear_market_screening' },
        outputs: { droppedOpps: beforeOpps - ws.opportunities.length, droppedProspects: beforeProspects - ws.prospects.length }
      });
      saveWorkspace(db, ws);
      res.json({
        droppedOpps: beforeOpps - ws.opportunities.length,
        droppedProspects: beforeProspects - ws.prospects.length
      });
    });
  });

  return router;
}
