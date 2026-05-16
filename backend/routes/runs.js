// Pipeline run history endpoints. The pipeline router writes each completed
// run's snapshot into workspace.pipelineRunHistory (capped at 5). This
// router exposes them:
//
//   GET /workspaces/:id/runs              — list metadata only (no big arrays)
//   GET /workspaces/:id/runs/:runId       — full snapshot (signals + opps + briefings)
//
// The opportunities + signals routes accept an optional ?runId query param
// — when set, they read from the historical snapshot instead of live state.
// That keeps the frontend simple: same API surface, just pass `runId`.

import { Router } from 'express';
import { getWorkspace } from '../lib/workspaceStore.js';
import { requireAuth } from './auth.js';

// Strip the heavy arrays from a run record so list responses stay small.
// A workspace with 5 archived runs × 600 signals each would otherwise
// return ~3MB of JSON just to populate a dropdown.
function summariseRun(run) {
  return {
    id: run.id,
    completedAt: run.completedAt,
    label: run.label,
    provider: run.provider,
    counts: run.counts || {
      signals: (run.signals || []).length,
      opportunities: (run.opportunities || []).length,
      briefings: (run.briefings || []).length
    }
  };
}

export function createRunsRouter(db) {
  const router = Router();

  // List runs (metadata only) + the active run pointer.
  router.get('/:id/runs', requireAuth, (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    const history = Array.isArray(ws.pipelineRunHistory) ? ws.pipelineRunHistory : [];
    // Synthesize a record for the LIVE run (whatever's currently in
    // workspace.signals/opportunities/briefings). It's not in history yet
    // — it gets archived on the NEXT pipeline run. Surface it so the
    // switcher can label it "current".
    const live = {
      id: ws.activeRunId || 'live',
      completedAt: ws.bakedAt || null,
      label: 'Live · current',
      provider: null,
      isLive: true,
      counts: {
        signals: (ws.signals || []).length,
        opportunities: (ws.opportunities || []).length,
        briefings: (ws.briefings || []).length
      }
    };
    res.json({
      live,
      // Most-recent archived run first — newer items are more interesting
      // when scrolling a dropdown.
      history: history.slice().reverse().map(summariseRun)
    });
  });

  // Full snapshot of a historical run. The caller is expected to use this
  // only when actively viewing a past run — heavy payload (signals can be
  // hundreds of KB).
  router.get('/:id/runs/:runId', requireAuth, (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    const run = (ws.pipelineRunHistory || []).find(r => r.id === req.params.runId);
    if (!run) return res.status(404).json({ error: 'run not found in history' });
    res.json({ run });
  });

  return router;
}

// Helper used by other routes to resolve a workspace + an optional runId
// override. Returns an object with the signals/opportunities/briefings the
// caller should treat as authoritative. Pure — does not mutate the
// workspace. Falls back to live state when runId is missing, equal to the
// active id, or 'live'.
export function viewForRun(workspace, runId) {
  if (!runId || runId === 'live' || runId === workspace.activeRunId) {
    return {
      signals: workspace.signals || [],
      opportunities: workspace.opportunities || [],
      briefings: workspace.briefings || [],
      isHistorical: false,
      runId: workspace.activeRunId || 'live'
    };
  }
  const run = (workspace.pipelineRunHistory || []).find(r => r.id === runId);
  if (!run) {
    // Unknown runId — fall back to live and let the caller decide whether
    // to surface a warning. Avoids 500s from a stale URL.
    return {
      signals: workspace.signals || [],
      opportunities: workspace.opportunities || [],
      briefings: workspace.briefings || [],
      isHistorical: false,
      runId: workspace.activeRunId || 'live',
      warning: 'requested_run_not_found'
    };
  }
  return {
    signals: run.signals || [],
    opportunities: run.opportunities || [],
    briefings: run.briefings || [],
    isHistorical: true,
    runId
  };
}
