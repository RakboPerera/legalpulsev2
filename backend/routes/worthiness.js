import { Router } from 'express';
import { getWorkspace } from '../lib/workspaceStore.js';
import { scoreEntityFromWorkspace } from '../lib/worthinessScorer.js';
import { requireAuth } from './auth.js';

export function createWorthinessRouter(db) {
  const router = Router();

  // GET /workspaces/:id/entities/:eid/worthiness
  // Returns the per-entity worthiness object (3 components for clients,
  // 2 for prospects). Computed on-the-fly from the workspace state.
  router.get('/:id/entities/:eid/worthiness', requireAuth, (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    const out = scoreEntityFromWorkspace(ws, req.params.eid);
    if (!out) return res.status(404).json({ error: 'entity not found' });
    res.json(out);
  });

  return router;
}
