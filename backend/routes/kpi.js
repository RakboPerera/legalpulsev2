import { Router } from 'express';
import { getWorkspace } from '../lib/workspaceStore.js';
import { computeKpiSummary } from '../lib/kpiAggregator.js';
import { requireAuth } from './auth.js';

const ALLOWED_RANGES = new Set(['all', '12m', '6m', 'active']);

export function createKpiRouter(db) {
  const router = Router();

  // GET /workspaces/:id/kpi/summary?range=all|12m|6m|active
  // Returns firm-wide + breakdowns (practice / partner / sector / client).
  // Server-side aggregation so the frontend stays dumb.
  router.get('/:id/kpi/summary', requireAuth, (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    const range = ALLOWED_RANGES.has(req.query.range) ? req.query.range : 'all';
    const summary = computeKpiSummary({
      matters:  ws.matters || [],
      clients:  ws.clients || [],
      partners: ws.partners || [],
      range
    });
    res.json(summary);
  });

  return router;
}
