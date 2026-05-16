// Operational Insights — the "exception lists" that surface matters needing
// management attention. Three categories:
//   1. Budget overruns       — actuals exceed budget by more than the threshold
//   2. Unprofitable matters  — margin below the firm's target
//   3. Stale matters         — active matters with no recent activity
//
// Pure functions: no DB, no LLM, no I/O. The route + worthiness scorer both
// consume these helpers, so they need to stay deterministic and side-effect
// free.

const FX_TO_GBP = { GBP: 1.0, USD: 0.79, EUR: 0.85 };
const ACTIVE_STATUSES = new Set(['active', 'in_progress', 'open']);

function gbp(amount, currency) {
  return (Number(amount) || 0) * (FX_TO_GBP[currency || 'GBP'] ?? 1.0);
}

// Stable 32-bit FNV-1a hash — matches the scheme used by the seed-KPI
// backfill so the "stale or recent" classification per matter is reproducible
// across runs.
function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function hash01(matterId, metric) {
  return hash32(`${matterId}:${metric}`) / 0xFFFFFFFF;
}

// Days since last activity. For closed matters this is the time since endDate;
// for active matters we don't have time-entry logs in the seed, so we use a
// deterministic per-matter spread: ~22% of active matters land in the stale
// bucket (70-200 days ago), the rest are recent (0-50 days ago). The
// classification is stable per matterId so the demo doesn't shuffle every
// reload.
export function daysSinceLastActivity(matter, nowMs = Date.now()) {
  if (matter.endDate) {
    const ts = new Date(matter.endDate).getTime();
    if (!isNaN(ts)) return Math.max(0, Math.round((nowMs - ts) / 86400000));
  }
  if (!ACTIVE_STATUSES.has(matter.status)) return null;
  const isStale = hash01(matter.id, 'stale') < 0.22;
  if (isStale) return 70 + Math.floor(hash01(matter.id, 'stale_days') * 130);
  return Math.floor(hash01(matter.id, 'recent_days') * 50);
}

function joinRow(matter, entityById, partnerById) {
  // Matter.client can point at either a client (c-*) or a prospect (pr-*).
  // The seed includes a handful of prospect-led matters (Sanofi, Pfizer, etc.)
  // so we look up across both populations to avoid showing raw IDs.
  const entity = entityById.get(matter.client);
  const partner = partnerById.get(matter.leadPartner);
  return {
    matterId:     matter.id,
    matterTitle:  matter.matterTitle,
    clientId:     matter.client,
    clientName:   entity?.legalName || matter.client,
    clientSector: entity?.sector || null,
    partnerId:    matter.leadPartner,
    partnerName:  partner?.name || matter.leadPartner,
    practiceArea: matter.practiceArea,
    status:       matter.status,
    startDate:    matter.startDate || null,
    endDate:      matter.endDate || null,
    currency:     matter.currency || 'GBP',
    feesBilled:   matter.feesBilled || 0,
    workedValue:  matter.workedValue || 0,
    budget:       matter.budget || 0,
    directCost:   matter.directCost || 0
  };
}

function buildEntityIndex(clients, prospects) {
  const m = new Map();
  for (const c of clients || []) m.set(c.id, c);
  for (const p of prospects || []) m.set(p.id, p);
  return m;
}

// Budget overruns: matters where feesBilled exceeds budget by more than
// `threshold` (default 10%). Sorted by overrun percentage, largest first.
export function findBudgetOverruns({ matters, clients, prospects, partners, threshold = 0.10 }) {
  const entityById = buildEntityIndex(clients, prospects);
  const partnerById = new Map((partners || []).map(p => [p.id, p]));
  const rows = [];
  for (const m of matters || []) {
    if (!m.budget || !m.feesBilled) continue;
    const fb = gbp(m.feesBilled, m.currency);
    const bg = gbp(m.budget, m.currency);
    if (bg <= 0) continue;
    const overrunPct = (fb - bg) / bg;
    if (overrunPct <= threshold) continue;
    rows.push({
      ...joinRow(m, entityById, partnerById),
      overrunPct,
      overrunGbp: Math.round(fb - bg)
    });
  }
  rows.sort((a, b) => b.overrunPct - a.overrunPct);
  return rows;
}

// Unprofitable matters: margin% below the threshold. Includes both closed
// matters (lessons learned, post-mortem) and active matters trending toward
// poor economics (intervene-now opportunities). The row carries the status
// so the page can visually distinguish "already lost" vs "still salvageable".
export function findUnprofitableMatters({ matters, clients, prospects, partners, threshold = 0.20 }) {
  const entityById = buildEntityIndex(clients, prospects);
  const partnerById = new Map((partners || []).map(p => [p.id, p]));
  const rows = [];
  for (const m of matters || []) {
    if (!m.feesBilled) continue;
    const fb = gbp(m.feesBilled, m.currency);
    const dc = gbp(m.directCost, m.currency);
    if (fb <= 0) continue;
    const marginPct = (fb - dc) / fb;
    if (marginPct >= threshold) continue;
    rows.push({
      ...joinRow(m, entityById, partnerById),
      marginPct,
      marginShortfallGbp: Math.round(fb * (threshold - marginPct))
    });
  }
  rows.sort((a, b) => a.marginPct - b.marginPct);
  return rows;
}

// Stale matters: active matters whose computed daysSinceLastActivity exceeds
// the threshold. Sorted by staleness, oldest first.
export function findStaleMatters({ matters, clients, prospects, partners, staleDays = 60, nowMs = Date.now() }) {
  const entityById = buildEntityIndex(clients, prospects);
  const partnerById = new Map((partners || []).map(p => [p.id, p]));
  const rows = [];
  for (const m of matters || []) {
    if (!ACTIVE_STATUSES.has(m.status)) continue;
    const days = daysSinceLastActivity(m, nowMs);
    if (days == null || days <= staleDays) continue;
    rows.push({
      ...joinRow(m, entityById, partnerById),
      daysSinceActivity: days
    });
  }
  rows.sort((a, b) => b.daysSinceActivity - a.daysSinceActivity);
  return rows;
}

// One-call payload: all three exception lists in a single API trip, plus the
// thresholds the server applied (so the frontend can show them and offer
// retuning).
export function computeOperationalInsights({
  matters, clients = [], prospects = [], partners = [],
  budgetThreshold = 0.10,
  marginThreshold = 0.20,
  staleDays = 60,
  nowMs = Date.now()
}) {
  const overruns      = findBudgetOverruns({ matters, clients, prospects, partners, threshold: budgetThreshold });
  const unprofitable  = findUnprofitableMatters({ matters, clients, prospects, partners, threshold: marginThreshold });
  const stale         = findStaleMatters({ matters, clients, prospects, partners, staleDays, nowMs });
  return {
    thresholds: { budgetThreshold, marginThreshold, staleDays },
    counts: {
      overruns: overruns.length,
      unprofitable: unprofitable.length,
      stale: stale.length
    },
    overruns,
    unprofitable,
    stale
  };
}
