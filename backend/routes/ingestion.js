import { Router } from 'express';
import { getWorkspace, saveWorkspace, withWorkspaceLock } from '../lib/workspaceStore.js';
import { addAuditEntry } from '../lib/audit.js';
import { runIngestionForWorkspace } from '../sources/orchestrator.js';
import { requireAuth } from './auth.js';
import { pick, isStringArray, badRequest } from '../lib/validate.js';
import { ALLOWED_SOURCES } from '../lib/sourcesConstants.js';

export function createIngestionRouter(db) {
  const router = Router();

  router.post('/:id/ingestion/run-now', requireAuth, async (req, res) => {
    try {
      const out = await withWorkspaceLock(req.params.id, async () => {
        const ws = getWorkspace(db, req.params.id, req.user.id);
        if (!ws) return { status: 404, body: { error: 'not found' } };
        const result = await runIngestionForWorkspace({ workspace: ws });
        addAuditEntry(ws, { type: 'ingestion', actor: 'ingestion_orchestrator', outputs: { totalSignals: result.totalSignals, perSource: result.perSource } });
        saveWorkspace(db, ws);
        return { status: 200, body: result };
      });
      res.status(out.status).json(out.body);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:id/ingestion/status', requireAuth, (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    const byType = (ws.signals || []).reduce((acc, s) => {
      acc[s.source] = (acc[s.source] || 0) + 1; return acc;
    }, {});
    // Per-source opportunity contribution lets the UI distinguish a source
    // that's loud-but-unproductive (many signals, no opps — monitoring
    // value only) from one that's actually feeding the briefing pipeline.
    const contributedToOpps = {};
    for (const opp of ws.opportunities || []) {
      const sigIds = new Set();
      for (const t of opp.triggers || []) if (t.signalId) sigIds.add(t.signalId);
      for (const ref of opp.basis?.citedSourceIds || []) sigIds.add(ref);
      const seenSrc = new Set();
      for (const sid of sigIds) {
        const s = (ws.signals || []).find(x => x.id === sid);
        if (s?.source) seenSrc.add(s.source);
      }
      for (const src of seenSrc) contributedToOpps[src] = (contributedToOpps[src] || 0) + 1;
    }
    res.json({
      totalSignals: ws.signals?.length || 0,
      bySource: byType,
      contributedToOpps,
      lastBakedAt: ws.bakedAt
    });
  });

  router.get('/:id/external-sources', requireAuth, (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    res.json({ config: ws.externalSourceConfig });
  });

  router.put('/:id/external-sources', requireAuth, async (req, res) => {
    const body = pick(req.body || {}, ['enabledSources', 'scopeFilters', 'ingestionSchedules']);
    if (body.enabledSources !== undefined) {
      if (!isStringArray(body.enabledSources, { max: 30 })) return badRequest(res, 'enabledSources invalid');
      body.enabledSources = body.enabledSources.filter(s => ALLOWED_SOURCES.has(s));
    }
    if (body.scopeFilters !== undefined) {
      if (!body.scopeFilters || typeof body.scopeFilters !== 'object') return badRequest(res, 'scopeFilters invalid');
    }
    if (body.ingestionSchedules !== undefined) {
      if (!body.ingestionSchedules || typeof body.ingestionSchedules !== 'object') return badRequest(res, 'ingestionSchedules invalid');
      const cleaned = {};
      for (const [k, v] of Object.entries(body.ingestionSchedules)) {
        if (ALLOWED_SOURCES.has(k) && typeof v === 'string' && v.length <= 60) cleaned[k] = v;
      }
      body.ingestionSchedules = cleaned;
    }
    let out;
    try {
      out = await withWorkspaceLock(req.params.id, async () => {
        const ws = getWorkspace(db, req.params.id, req.user.id);
        if (!ws) return { status: 404, body: { error: 'not found' } };
        ws.externalSourceConfig = { ...ws.externalSourceConfig, ...body };
        saveWorkspace(db, ws);
        return { status: 200, body: { config: ws.externalSourceConfig } };
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(out.status).json(out.body);
  });

  return router;
}
