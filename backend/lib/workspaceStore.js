import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildHeuristicPitch } from './pitchHeuristic.js';
import { retrieveSimilarPitches } from './pitchRetrieval.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const seedDir = path.join(__dirname, '..', '..', 'data', 'seed');
const snapshotPath = path.join(__dirname, '..', '..', 'data', 'demo-snapshot.json');
const rejectedPath = path.join(__dirname, '..', '..', 'data', 'rejected-opportunities.json');

// Optional sidecar — historical drops with curated reason text. Loaded if
// present so the Reasoning Trail can show "what was filtered and why".
// Absence is fine — the page just renders 0 rejections.
function readRejectedOpportunities() {
  if (!fs.existsSync(rejectedPath)) return null;
  try { return JSON.parse(fs.readFileSync(rejectedPath, 'utf8')); }
  catch (err) { console.warn('[workspaceStore] rejected-opportunities parse failed:', err.message); return null; }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(seedDir, file), 'utf8'));
}

// Fields that the v3 Commercial Health work added to the seed entities. When
// older snapshots (baked before these fields existed) get loaded, we copy the
// seed-side values onto the snapshot entities by id. Auto-discovered entities
// that are not in the seed get neutral defaults so the worthiness scorer never
// blows up on an undefined value.
const COMMERCIAL_FIELDS_ENTITY = ['creditRating', 'creditOutlook', 'riskFlags'];
const DEFAULT_ENTITY_COMMERCIAL = { creditRating: 'BBB', creditOutlook: 'stable', riskFlags: [] };

function mergeCommercialFields(snapshotList, seedList) {
  if (!Array.isArray(snapshotList) || !snapshotList.length) return snapshotList;
  const seedById = new Map((seedList || []).map(e => [e.id, e]));
  return snapshotList.map(entity => {
    const fromSeed = seedById.get(entity.id);
    const merged = { ...entity };
    for (const key of COMMERCIAL_FIELDS_ENTITY) {
      if (merged[key] !== undefined) continue;       // snapshot wins when present
      if (fromSeed && fromSeed[key] !== undefined) {  // then seed
        merged[key] = fromSeed[key];
      } else {
        merged[key] = DEFAULT_ENTITY_COMMERCIAL[key]; // finally neutral default
      }
    }
    return merged;
  });
}

// Matter financial KPI fields added by the v3 Commercial Health work. Existing
// workspaces stored before the backfill have matters with only `feesBilled` —
// margin/realisation/write-off all read as broken in the UI. We overlay these
// fields from the current seed file by matter ID at load time, so older
// workspaces transparently pick up the new financial data without needing the
// user to re-create their workspace.
const MATTER_KPI_FIELDS = ['workedValue', 'feesCollected', 'directCost', 'budget', 'paymentDays', 'kpiSource'];

function mergeMatterKpis(storedMatters) {
  if (!Array.isArray(storedMatters) || !storedMatters.length) return storedMatters;
  let seedMatters = [];
  try { seedMatters = readJson('matters.json'); } catch { return storedMatters; }
  const seedById = new Map(seedMatters.map(m => [m.id, m]));
  return storedMatters.map(matter => {
    const fromSeed = seedById.get(matter.id);
    if (!fromSeed) return matter;
    const merged = { ...matter };
    for (const key of MATTER_KPI_FIELDS) {
      if (merged[key] === undefined && fromSeed[key] !== undefined) {
        merged[key] = fromSeed[key];
      }
    }
    return merged;
  });
}

// Pre-generate heuristic pitch documents for every opportunity so the
// PitchModal opens with a draft ready to download — no API key required, no
// click-to-generate step in the demo. Pure deterministic templating; sub-ms
// even for ~50 opportunities. Skipped per-opp if a real pitch already exists
// (e.g. one the partner triggered with BYOK).
function ensureOpportunityPitches(state) {
  if (!state || !Array.isArray(state.opportunities) || state.opportunities.length === 0) return state;
  const entityById = new Map([
    ...(state.clients || []),
    ...(state.prospects || [])
  ].map(e => [e.id, e]));
  const briefingByOpp = new Map((state.briefings || []).map(b => [b.opportunityId, b]));
  const existingPitches = new Set((state.pitches || [])
    .filter(p => typeof p.id === 'string' && p.id.startsWith('pitch-'))
    .map(p => p.opportunityId));

  const newPitches = [];
  for (const opp of state.opportunities) {
    if (existingPitches.has(opp.id)) continue;
    const entity = entityById.get(opp.entity);
    if (!entity) continue;
    try {
      const exemplars = retrieveSimilarPitches({ opportunity: opp, entity, workspace: state, k: 4 });
      const pitch = buildHeuristicPitch({ opportunity: opp, entity, briefing: briefingByOpp.get(opp.id), exemplars, workspace: state });
      newPitches.push({
        id: `pitch-${opp.id}`,
        opportunityId: opp.id,
        generatedAt: new Date().toISOString(),
        generatedBy: 'pre_generation_on_load',
        ...pitch
      });
    } catch (err) {
      console.warn(`[ensureOpportunityPitches] failed for ${opp.id}: ${err.message}`);
    }
  }
  if (newPitches.length) {
    state.pitches = [...(state.pitches || []), ...newPitches];
  }
  return state;
}

export function buildEmptyWorkspaceState(mode, name) {
  return {
    name,
    mode,
    firmProfile: null,
    partners: [],
    serviceTaxonomy: { practiceAreas: {} },
    clients: [],
    prospects: [],
    matters: [],
    pitches: [],
    signals: [],
    opportunities: [],
    briefings: [],
    auditTrail: [],
    chatHistory: [],
    conflicts: [],
    externalSourceConfig: {
      enabledSources: ['gdelt', 'edgar', 'courtlistener', 'companies_house', 'ofac_sdn', 'eu_sanctions', 'uk_ofsi'],
      scopeFilters: { geographies: ['UK', 'EU', 'USA'], industries: [], practiceAreas: [] },
      ingestionSchedules: { gdelt: '0 */4 * * *', edgar: '0 2 * * *', courtlistener: '0 3 * * *' }
    }
  };
}

export function buildDemoWorkspaceState() {
  const firmProfile = readJson('firm-profile.json');
  const partners = readJson('partners.json');
  const serviceTaxonomy = readJson('service-taxonomy.json');
  const clients = readJson('clients.json');
  const prospects = readJson('prospects.json');
  const matters = readJson('matters.json');
  const conflicts = readJson('conflicts.json');
  // Pitch corpus is optional — older seed sets may not include it. We treat
  // an empty file as "no historical pitches" rather than a fatal error.
  let pitches = [];
  try { pitches = readJson('pitches.json'); } catch { /* noop */ }

  const state = {
    name: 'Hartwell & Stone (demo)',
    mode: 'demo',
    firmProfile,
    partners,
    serviceTaxonomy,
    clients,
    prospects,
    matters,
    pitches,
    signals: [],
    opportunities: [],
    briefings: [],
    auditTrail: [],
    chatHistory: [],
    conflicts: conflicts.conflicts,
    externalSourceConfig: {
      enabledSources: ['gdelt', 'edgar', 'courtlistener', 'companies_house', 'ofac_sdn', 'eu_sanctions', 'uk_ofsi', 'doj', 'ftc', 'dg_comp', 'fca', 'lexology', 'jd_supra'],
      scopeFilters: { geographies: ['UK', 'EU', 'USA'], industries: [], practiceAreas: [] },
      ingestionSchedules: {}
    }
  };

  if (fs.existsSync(snapshotPath)) {
    try {
      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      // Prefer snapshot clients/prospects when present — they include
      // auto-discovered entities that aren't in seed JSONs. Merge the
      // v3 commercial fields (creditRating / creditOutlook / riskFlags)
      // from seed by id so older snapshots automatically pick them up
      // without an immediate re-bake.
      if (Array.isArray(snapshot.clients) && snapshot.clients.length) {
        state.clients = mergeCommercialFields(snapshot.clients, clients);
      }
      if (Array.isArray(snapshot.prospects) && snapshot.prospects.length) {
        state.prospects = mergeCommercialFields(snapshot.prospects, prospects);
      }
      state.signals = snapshot.signals || [];
      state.opportunities = snapshot.opportunities || [];
      state.briefings = snapshot.briefings || [];
      state.auditTrail = snapshot.auditTrail || [];
      state.chatHistory = snapshot.chatHistory || [];
      if (snapshot.bakedAt) state.bakedAt = snapshot.bakedAt;
    } catch (err) {
      console.warn('[workspaceStore] failed to load demo snapshot:', err.message);
    }
  }
  // Side-load curated rejection data (drops + reasons). Stored separately
  // from the snapshot because it's a different lifecycle — written by the
  // reconstruction script + (future) bake-time drop-path instrumentation,
  // not by the bake itself.
  const rej = readRejectedOpportunities();
  if (rej) {
    state.rejectedOpportunities = rej.rejections || [];
    state.reasonTaxonomy = rej.reasonTaxonomy || {};
  }
  return state;
}

// Overlay the latest data/demo-snapshot.json onto an existing demo workspace.
// Replaces bake-derived fields (signals, opportunities, briefings, audit trail,
// chatHistory, bakedAt) but preserves workspace identity (id, userId, name,
// createdAt) and any user-edited state on opportunities/briefings is lost — the
// snapshot wins. Only legal for mode === 'demo' workspaces.
export function reloadDemoSnapshot(state) {
  if (state.mode !== 'demo') {
    throw new Error('reloadDemoSnapshot: workspace is not in demo mode');
  }
  if (!fs.existsSync(snapshotPath)) {
    throw new Error('reloadDemoSnapshot: data/demo-snapshot.json not found — run `npm run bake` first');
  }
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  // Refresh seed-derived state too — when seed JSONs change (new clients
  // added, partners reorganised, matters added), an existing demo workspace
  // would otherwise stay frozen on whatever was on disk at createWorkspace
  // time. The card UI then renders entity IDs like "c-apple" because the new
  // entity isn't in the workspace's clients list.
  try {
    state.firmProfile = readJson('firm-profile.json');
    state.partners = readJson('partners.json');
    state.serviceTaxonomy = readJson('service-taxonomy.json');
    state.clients = readJson('clients.json');
    state.prospects = readJson('prospects.json');
    state.matters = readJson('matters.json');
    state.conflicts = readJson('conflicts.json').conflicts;
    try { state.pitches = readJson('pitches.json'); } catch { state.pitches = state.pitches || []; }
  } catch (err) {
    console.warn('[reloadDemoSnapshot] seed reload partial-failure:', err.message);
  }
  // If the snapshot persisted its own clients/prospects (newer bakes do),
  // prefer those over the seed JSONs. The bake may have added auto-
  // discovered entities (discoverySource: 'auto_event_screening' or
  // 'market_screening') that aren't in seed; without this overlay,
  // workspace.opportunities reference entity IDs that don't exist in the
  // workspace state and OppCard renders raw IDs.
  if (Array.isArray(snapshot.clients) && snapshot.clients.length) {
    // Same seed-merge as buildDemoWorkspaceState — keep commercial fields
    // available even on older snapshots, and apply neutral defaults to any
    // auto-discovered entity that isn't in the seed at all.
    state.clients = mergeCommercialFields(snapshot.clients, state.clients);
  }
  if (Array.isArray(snapshot.prospects) && snapshot.prospects.length) {
    state.prospects = mergeCommercialFields(snapshot.prospects, state.prospects);
  }
  state.signals = snapshot.signals || [];
  state.opportunities = snapshot.opportunities || [];
  state.briefings = snapshot.briefings || [];
  state.auditTrail = snapshot.auditTrail || [];
  state.chatHistory = snapshot.chatHistory || [];
  if (snapshot.bakedAt) state.bakedAt = snapshot.bakedAt;

  // Matters always come from seed in reloadDemoSnapshot, so they already
  // have KPI fields — but apply the overlay defensively for forward-compat.
  state.matters = mergeMatterKpis(state.matters);
  // Refresh pre-generated pitches after the snapshot replaced opportunities.
  state.pitches = (state.pitches || []).filter(p => !(typeof p.id === 'string' && p.id.startsWith('pitch-')));
  ensureOpportunityPitches(state);

  // Re-overlay rejection sidecar (drops + reasons) — same lifecycle as the
  // snapshot from a partner's perspective: "Reload from latest bake" should
  // refresh both.
  const rej = readRejectedOpportunities();
  if (rej) {
    state.rejectedOpportunities = rej.rejections || [];
    state.reasonTaxonomy = rej.reasonTaxonomy || {};
  }

  return state;
}

export function createWorkspace(db, userId, { mode, name }) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const state = mode === 'demo' ? buildDemoWorkspaceState() : buildEmptyWorkspaceState(mode, name);
  state.id = id;
  state.userId = userId;
  state.createdAt = now;
  state.updatedAt = now;
  db.prepare(`INSERT INTO workspaces (id, userId, name, mode, data, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, userId, state.name, mode, JSON.stringify(state), now, now);
  return state;
}

// Per-workspace in-memory cache for the assembled state. Every read path
// (list, get, chat, audit) used to re-run seed merges + pitch
// pre-population on every call — measured at ~30-80ms per request on a
// large workspace. Cache key is (workspaceId, updatedAt) so any mutation
// invalidates automatically.
const _wsCache = new Map();
const _WS_CACHE_LIMIT = 64;

function _cacheGet(id, updatedAt) {
  const entry = _wsCache.get(id);
  if (entry && entry.updatedAt === updatedAt) return entry.state;
  return null;
}
function _cacheSet(id, updatedAt, state) {
  if (_wsCache.size >= _WS_CACHE_LIMIT) {
    const firstKey = _wsCache.keys().next().value;
    if (firstKey) _wsCache.delete(firstKey);
  }
  _wsCache.set(id, { updatedAt, state });
}
export function invalidateWorkspaceCache(id) {
  if (id) _wsCache.delete(id); else _wsCache.clear();
}

export function getWorkspace(db, id, userId) {
  const row = userId
    ? db.prepare(`SELECT * FROM workspaces WHERE id = ? AND userId = ?`).get(id, userId)
    : db.prepare(`SELECT * FROM workspaces WHERE id = ?`).get(id);
  if (!row) return null;

  // Cache hit: the JSON blob hasn't changed (same updatedAt) so the
  // assembled state is still valid. Skip the parse + seed merges entirely.
  const cached = _cacheGet(id, row.updatedAt);
  if (cached) return cached;

  const state = JSON.parse(row.data);
  // Defensive: ensure arrays/objects exist even on older serialisations.
  state.clients = state.clients || [];
  state.prospects = state.prospects || [];
  state.matters = state.matters || [];
  state.pitches = state.pitches || [];
  state.signals = state.signals || [];
  state.opportunities = state.opportunities || [];
  state.briefings = state.briefings || [];
  state.auditTrail = state.auditTrail || [];
  state.chatHistory = state.chatHistory || [];
  state.partners = state.partners || [];
  state.conflicts = state.conflicts || [];
  state.externalSourceConfig = state.externalSourceConfig || { enabledSources: [], scopeFilters: {}, ingestionSchedules: {} };

  // === v3 retrofit for older workspaces ===
  state.matters = mergeMatterKpis(state.matters);
  if (state.clients.length) {
    let seedClients = [];
    try { seedClients = readJson('clients.json'); } catch {}
    state.clients = mergeCommercialFields(state.clients, seedClients);
  }
  if (state.prospects.length) {
    let seedProspects = [];
    try { seedProspects = readJson('prospects.json'); } catch {}
    state.prospects = mergeCommercialFields(state.prospects, seedProspects);
  }
  ensureOpportunityPitches(state);

  _cacheSet(id, row.updatedAt, state);
  return state;
}

export function saveWorkspace(db, state) {
  state.updatedAt = new Date().toISOString();
  db.prepare(`UPDATE workspaces SET name = ?, data = ?, updatedAt = ? WHERE id = ?`)
    .run(state.name, JSON.stringify(state), state.updatedAt, state.id);
  invalidateWorkspaceCache(state.id);
  return state;
}

export function listWorkspaces(db, userId) {
  const rows = db.prepare(`SELECT id, name, mode, createdAt, updatedAt FROM workspaces WHERE userId = ? ORDER BY updatedAt DESC`).all(userId);
  return rows;
}

export function deleteWorkspace(db, id, userId) {
  db.prepare(`DELETE FROM workspaces WHERE id = ? AND userId = ?`).run(id, userId);
  invalidateWorkspaceCache(id);
}

// Per-workspace mutex. Serialises mutations so concurrent engine / ingestion /
// chat runs cannot overwrite each other's writes to the workspace JSON blob.
const _wsLocks = new Map();
export async function withWorkspaceLock(workspaceId, fn) {
  const prev = _wsLocks.get(workspaceId) || Promise.resolve();
  let release;
  const next = new Promise(r => { release = r; });
  // Swallow upstream errors so one failed acquisition does NOT poison the
  // lock chain for the entire workspace. Each operation's own try/catch
  // surfaces its own error to its caller.
  _wsLocks.set(workspaceId, prev.then(() => next, () => next));
  try {
    try { await prev; } catch { /* prior op failed — proceed anyway */ }
    return await fn();
  } finally {
    release();
    if (_wsLocks.get(workspaceId) === next) _wsLocks.delete(workspaceId);
  }
}
