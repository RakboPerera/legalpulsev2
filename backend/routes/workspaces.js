import { Router } from 'express';
import multer from 'multer';
import { createWorkspace, getWorkspace, listWorkspaces, saveWorkspace, deleteWorkspace, withWorkspaceLock, reloadDemoSnapshot } from '../lib/workspaceStore.js';
import { addAuditEntry, auditFilter } from '../lib/audit.js';
import { requireAuth } from './auth.js';
import { pick, isString, isOneOf, isStringArray, badRequest } from '../lib/validate.js';
import { ALLOWED_SOURCES, ALLOWED_GEOGRAPHIES } from '../lib/sourcesConstants.js';
import { viewForRun } from './runs.js';
import { ingestCsv, CSV_LIMITS } from '../lib/csvImport.js';

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CSV_LIMITS.MAX_BYTES, files: 2 }
}).fields([
  { name: 'clients', maxCount: 1 },
  { name: 'matters', maxCount: 1 }
]);

function summarize(ws, full = false) {
  const base = {
    id: ws.id,
    name: ws.name,
    mode: ws.mode,
    createdAt: ws.createdAt,
    updatedAt: ws.updatedAt,
    counts: {
      clients: ws.clients?.length || 0,
      prospects: ws.prospects?.length || 0,
      matters: ws.matters?.length || 0,
      signals: ws.signals?.length || 0,
      opportunities: ws.opportunities?.length || 0,
      briefings: ws.briefings?.length || 0,
      auditEntries: ws.auditTrail?.length || 0
    },
    bakedAt: ws.bakedAt || null
  };
  if (!full) return base;
  return {
    ...base,
    firmProfile: ws.firmProfile,
    partners: ws.partners,
    serviceTaxonomy: ws.serviceTaxonomy,
    externalSourceConfig: ws.externalSourceConfig
  };
}

export function createWorkspacesRouter(db) {
  const router = Router();

  router.get('/', requireAuth, (req, res) => {
    res.json({ workspaces: listWorkspaces(db, req.user.id) });
  });

  router.post('/', requireAuth, (req, res) => {
    const body = req.body || {};
    if (!isOneOf(body.mode, ['demo', 'user_input'])) return badRequest(res, 'mode must be demo or user_input');
    const name = isString(body.name, { max: 120 }) ? body.name : (body.mode === 'demo' ? 'Hartwell & Stone (demo)' : 'New Workspace');
    const ws = createWorkspace(db, req.user.id, { mode: body.mode, name });
    addAuditEntry(ws, { type: 'user_action', actor: req.user.email, outputs: { action: 'workspace_created', mode: body.mode } });
    saveWorkspace(db, ws);
    res.status(201).json({ workspace: summarize(ws) });
  });

  router.get('/:id', requireAuth, (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    res.json({ workspace: summarize(ws, true) });
  });

  router.patch('/:id', requireAuth, async (req, res) => {
    let out;
    try {
      out = await withWorkspaceLock(req.params.id, async () => {
        const ws = getWorkspace(db, req.params.id, req.user.id);
        if (!ws) return { status: 404, body: { error: 'not found' } };
        const body = pick(req.body || {}, ['name', 'externalSourceConfig']);
        if (body.name !== undefined) {
          if (!isString(body.name, { max: 120 })) return { status: 400, body: { error: 'name invalid' } };
          ws.name = body.name;
        }
        if (body.externalSourceConfig !== undefined) {
          const next = sanitizeExternalConfig(body.externalSourceConfig, ws.externalSourceConfig);
          if (!next) return { status: 400, body: { error: 'externalSourceConfig invalid' } };
          ws.externalSourceConfig = next;
        }
        saveWorkspace(db, ws);
        return { status: 200, body: { workspace: summarize(ws) } };
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(out.status).json(out.body);
  });

  router.delete('/:id', requireAuth, (req, res) => {
    deleteWorkspace(db, req.params.id, req.user.id);
    res.status(204).end();
  });

  // Reload bake-derived fields from data/demo-snapshot.json. Useful after
  // re-running `npm run bake` to pull the new opportunities/briefings/signals
  // into an existing demo workspace without losing its id or having to create
  // a new one.
  router.post('/:id/reload-snapshot', requireAuth, async (req, res) => {
    try {
      await withWorkspaceLock(req.params.id, async () => {
        const ws = getWorkspace(db, req.params.id, req.user.id);
        if (!ws) { res.status(404).json({ error: 'not found' }); return; }
        if (ws.mode !== 'demo') { res.status(400).json({ error: 'reload-snapshot only applies to demo workspaces' }); return; }
        console.log(`[reload-snapshot] starting for ${ws.id} (${ws.name})`);
        reloadDemoSnapshot(ws);
        console.log(`[reload-snapshot] snapshot loaded — signals=${ws.signals.length} opps=${ws.opportunities.length} briefings=${ws.briefings.length}`);
        addAuditEntry(ws, { type: 'user_action', actor: req.user.email, outputs: { action: 'workspace_reloaded_from_snapshot', bakedAt: ws.bakedAt } });
        saveWorkspace(db, ws);
        console.log(`[reload-snapshot] saved workspace ${ws.id}`);
        res.json({ workspace: summarize(ws, true) });
      });
    } catch (err) {
      console.error('[reload-snapshot] FAIL:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || String(err), stack: err.stack?.split('\n').slice(0, 5).join('\n') });
      }
    }
  });

  router.get('/:id/clients', requireAuth, (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    res.json({ clients: ws.clients, prospects: ws.prospects });
  });

  // User Input Mode: upload clients.csv and/or matters.csv as multipart
  // form data. Field names: "clients" and "matters" (both optional).
  // Returns a per-file summary of added / skipped / errors so the UI can
  // show what landed and what didn't.
  router.post('/:id/ingest-csv', requireAuth, (req, res, next) => {
    csvUpload(req, res, err => {
      if (err) {
        const isLimit = err.code === 'LIMIT_FILE_SIZE';
        return res.status(400).json({
          error: isLimit ? 'file_too_large' : 'upload_failed',
          message: isLimit
            ? `One of the files is larger than ${Math.round(CSV_LIMITS.MAX_BYTES / 1024)} KB.`
            : (err.message || 'Upload failed.')
        });
      }
      next();
    });
  }, async (req, res) => {
    let out;
    try {
      out = await withWorkspaceLock(req.params.id, async () => {
        const ws = getWorkspace(db, req.params.id, req.user.id);
        if (!ws) return { status: 404, body: { error: 'not_found', message: 'Workspace not found.' } };
        if (ws.mode !== 'user_input') {
          return { status: 400, body: { error: 'wrong_mode', message: 'CSV ingestion is only supported in user input mode.' } };
        }
        const files = {};
        if (req.files?.clients?.[0]) files.clients = req.files.clients[0];
        if (req.files?.matters?.[0]) files.matters = req.files.matters[0];
        if (!files.clients && !files.matters) {
          return { status: 400, body: { error: 'no_files', message: 'Upload at least one of: clients.csv or matters.csv.' } };
        }
        const before = { clients: ws.clients?.length || 0, matters: ws.matters?.length || 0 };
        const result = ingestCsv(ws, files);
        if (!result.ok) return { status: 400, body: { error: 'ingest_failed', message: result.error } };
        addAuditEntry(ws, {
          type: 'user_action',
          actor: req.user.email,
          inputs: {
            files: Object.keys(files).join(','),
            byteCount: Object.values(files).reduce((a, f) => a + f.size, 0)
          },
          outputs: {
            action: 'csv_ingest',
            clientsAdded: result.summary.clients.added,
            mattersAdded: result.summary.matters.added,
            clientsSkipped: result.summary.clients.skipped,
            mattersSkipped: result.summary.matters.skipped,
            clientsErrorCount: result.summary.clients.errors.length,
            mattersErrorCount: result.summary.matters.errors.length
          }
        });
        saveWorkspace(db, ws);
        return {
          status: 200,
          body: {
            summary: result.summary,
            counts: {
              clientsBefore: before.clients,
              clientsAfter: ws.clients.length,
              mattersBefore: before.matters,
              mattersAfter: ws.matters.length
            }
          }
        };
      });
    } catch (err) {
      console.error('[ingest-csv] FAIL:', err);
      return res.status(500).json({ error: 'ingest_failed', message: err.message || String(err) });
    }
    res.status(out.status).json(out.body);
  });

  router.get('/:id/clients/:cid', requireAuth, (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    const c = ws.clients.find(x => x.id === req.params.cid) || ws.prospects.find(x => x.id === req.params.cid);
    if (!c) return res.status(404).json({ error: 'entity not found' });
    const matters = ws.matters.filter(m => m.client === c.id);
    const signals = ws.signals.filter(s => (s.entities || []).some(e => e.entityId === c.id));
    const opportunities = ws.opportunities.filter(o => o.entity === c.id);
    res.json({ entity: c, matters, signals, opportunities });
  });

  router.get('/:id/matters', requireAuth, (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    res.json({ matters: ws.matters });
  });

  router.get('/:id/signals', requireAuth, (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    const source = isString(req.query.source, { max: 64 }) ? req.query.source : null;
    const entity = isString(req.query.entity, { max: 64 }) ? req.query.entity : null;
    // Optional ?runId — swap to archived run's signal pool. Falls back to
    // live state when missing or unknown.
    const view = viewForRun(ws, req.query.runId);
    let signals = view.signals;
    if (source) signals = signals.filter(s => s.source === source);
    if (entity) signals = signals.filter(s => (s.entities || []).some(e => e.entityId === entity));
    res.json({
      signals: signals.slice(-limit).reverse(),
      total: signals.length,
      runId: view.runId,
      isHistorical: view.isHistorical
    });
  });

  router.get('/:id/signals/:sid', requireAuth, (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    const sig = ws.signals.find(s => s.id === req.params.sid);
    if (!sig) return res.status(404).json({ error: 'not found' });
    res.json({ signal: sig });
  });

  router.get('/:id/audit', requireAuth, (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    const result = auditFilter(ws.auditTrail || [], {
      type: isString(req.query.type, { max: 64 }) ? req.query.type : undefined,
      since: isString(req.query.since, { max: 40 }) ? req.query.since : undefined,
      until: isString(req.query.until, { max: 40 }) ? req.query.until : undefined,
      entityId: isString(req.query.entityId, { max: 64 }) ? req.query.entityId : undefined,
      source: isString(req.query.source, { max: 64 }) ? req.query.source : undefined,
      limit: Math.min(Math.max(Number(req.query.limit) || 200, 1), 500),
      offset: Math.max(Number(req.query.offset) || 0, 0)
    });
    res.json(result);
  });

  router.get('/:id/firm-profile', requireAuth, (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    res.json({ firmProfile: ws.firmProfile, partners: ws.partners, serviceTaxonomy: ws.serviceTaxonomy });
  });

  return router;
}

function sanitizeExternalConfig(input, current) {
  if (!input || typeof input !== 'object') return null;
  const out = { ...current };
  if (input.enabledSources !== undefined) {
    if (!isStringArray(input.enabledSources, { max: 30 })) return null;
    out.enabledSources = input.enabledSources.filter(s => ALLOWED_SOURCES.has(s));
  }
  if (input.scopeFilters !== undefined) {
    const sf = input.scopeFilters || {};
    if (typeof sf !== 'object') return null;
    const scope = { ...(current?.scopeFilters || {}) };
    if (sf.geographies !== undefined) {
      if (!isStringArray(sf.geographies, { max: 10 })) return null;
      scope.geographies = sf.geographies.filter(g => ALLOWED_GEOGRAPHIES.has(g));
    }
    if (sf.industries !== undefined) {
      if (!isStringArray(sf.industries, { max: 40 })) return null;
      scope.industries = sf.industries;
    }
    if (sf.practiceAreas !== undefined) {
      if (!isStringArray(sf.practiceAreas, { max: 40 })) return null;
      scope.practiceAreas = sf.practiceAreas;
    }
    out.scopeFilters = scope;
  }
  if (input.ingestionSchedules !== undefined) {
    if (typeof input.ingestionSchedules !== 'object' || input.ingestionSchedules === null) return null;
    const sched = {};
    for (const [k, v] of Object.entries(input.ingestionSchedules)) {
      if (!ALLOWED_SOURCES.has(k)) continue;
      if (typeof v !== 'string' || v.length > 60) continue;
      sched[k] = v;
    }
    out.ingestionSchedules = sched;
  }
  return out;
}
