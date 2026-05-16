import { Router } from 'express';
import { getWorkspace } from '../lib/workspaceStore.js';
import { computeOperationalInsights } from '../lib/operationalInsights.js';
import { requireAuth } from './auth.js';

function clampFloat(value, lo, hi, fallback) {
  const n = parseFloat(value);
  if (!isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}
function clampInt(value, lo, hi, fallback) {
  const n = parseInt(value, 10);
  if (!isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

export function createInsightsRouter(db) {
  const router = Router();

  // GET /workspaces/:id/insights/operational
  //   ?budgetThreshold=0.10   (default 10%, range 0..1)
  //   ?marginThreshold=0.20   (default 20%, range 0..1)
  //   ?staleDays=60           (default 60, range 1..365)
  //
  // Returns { thresholds, counts, overruns[], unprofitable[], stale[] } —
  // one trip from the frontend. Server-aggregated.
  router.get('/:id/insights/operational', requireAuth, (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    const budgetThreshold = clampFloat(req.query.budgetThreshold, 0, 1, 0.10);
    const marginThreshold = clampFloat(req.query.marginThreshold, 0, 1, 0.20);
    const staleDays       = clampInt(req.query.staleDays, 1, 365, 60);
    const out = computeOperationalInsights({
      matters:   ws.matters   || [],
      clients:   ws.clients   || [],
      prospects: ws.prospects || [],
      partners:  ws.partners  || [],
      budgetThreshold, marginThreshold, staleDays
    });
    res.json(out);
  });

  return router;
}
