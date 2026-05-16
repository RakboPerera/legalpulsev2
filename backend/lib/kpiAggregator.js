// Firm-wide commercial-health KPIs computed from the matter ledger.
//
// All aggregates are normalised to GBP using a static FX table — sufficient
// for the demo. A real firm deployment would pull rates from a market-data
// feed and add an as-of timestamp; the surface area below stays the same.
//
// Pure functions: no DB, no LLM, no I/O. Safe to call from any route or test.

const FX_TO_GBP = { GBP: 1.0, USD: 0.79, EUR: 0.85 };

function normalizeToGbp(amount, currency) {
  const rate = FX_TO_GBP[currency || 'GBP'] ?? 1.0;
  return (Number(amount) || 0) * rate;
}

function safePct(numerator, denominator) {
  if (!denominator || denominator === 0) return null;
  return numerator / denominator;
}

const ACTIVE_STATUSES = new Set(['active', 'in_progress', 'open']);

// Range filter — drops matters outside the requested window. A matter is
// 'in window' if either (a) it's still active (any active matter counts as
// current state regardless of startDate), or (b) it closed within the window.
export function filterMattersByRange(matters, range) {
  if (!range || range === 'all') return matters;
  if (range === 'active') return matters.filter(m => ACTIVE_STATUSES.has(m.status));
  const now = Date.now();
  const windowDays = range === '12m' ? 365 : range === '6m' ? 182 : 365;
  const cutoff = now - windowDays * 86400000;
  return matters.filter(m => {
    if (ACTIVE_STATUSES.has(m.status)) return true;
    const end = m.endDate ? new Date(m.endDate).getTime() : null;
    return end && end >= cutoff;
  });
}

// Core aggregation across a list of matters. Returns counts, totals, and
// derived percentages (write-off / realisation / margin / avg DSO).
//
// Convention: realisation% and avg DSO are computed across CLOSED matters
// only — active matters' feesCollected and paymentDays are partial / null
// and would skew the firm-level reading. Write-off and margin include all
// matters because the seed treats workedValue + directCost as final per-
// matter values regardless of status.
export function aggregateMatters(matters) {
  let totalFeesBilled = 0;
  let totalWorkedValue = 0;
  let totalFeesCollected = 0;
  let totalDirectCost = 0;
  let totalBudget = 0;
  let closedFeesBilled = 0;
  let closedFeesCollected = 0;
  let activeCount = 0;
  let closedCount = 0;
  const paymentDays = [];

  for (const m of matters) {
    const feesBilled    = normalizeToGbp(m.feesBilled,    m.currency);
    const workedValue   = normalizeToGbp(m.workedValue,   m.currency);
    const feesCollected = normalizeToGbp(m.feesCollected, m.currency);
    const directCost    = normalizeToGbp(m.directCost,    m.currency);
    const budget        = normalizeToGbp(m.budget,        m.currency);
    totalFeesBilled    += feesBilled;
    totalWorkedValue   += workedValue;
    totalFeesCollected += feesCollected;
    totalDirectCost    += directCost;
    totalBudget        += budget;
    if (ACTIVE_STATUSES.has(m.status)) {
      activeCount++;
    } else {
      closedCount++;
      closedFeesBilled    += feesBilled;
      closedFeesCollected += feesCollected;
      if (typeof m.paymentDays === 'number') paymentDays.push(m.paymentDays);
    }
  }

  return {
    count: matters.length,
    activeCount,
    closedCount,
    feesBilled:    Math.round(totalFeesBilled),
    workedValue:   Math.round(totalWorkedValue),
    feesCollected: Math.round(totalFeesCollected),
    directCost:    Math.round(totalDirectCost),
    budget:        Math.round(totalBudget),
    writeOffPct:    safePct(totalWorkedValue - totalFeesBilled, totalWorkedValue),
    realisationPct: safePct(closedFeesCollected, closedFeesBilled),
    marginPct:      safePct(totalFeesBilled - totalDirectCost, totalFeesBilled),
    avgDso: paymentDays.length
      ? paymentDays.reduce((s, d) => s + d, 0) / paymentDays.length
      : null
  };
}

function groupAggregate(matters, keyFn) {
  const groups = new Map();
  for (const m of matters) {
    const k = keyFn(m);
    if (k == null || k === '') continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  return Array.from(groups.entries())
    .map(([key, mts]) => ({ key, ...aggregateMatters(mts) }))
    .sort((a, b) => b.feesBilled - a.feesBilled);
}

// The full dashboard payload: firm-wide + breakdowns by practice / partner /
// sector / client. Single trip from the API — no per-row fetches.
export function computeKpiSummary({ matters, clients = [], partners = [], range = 'all' }) {
  const filtered = filterMattersByRange(matters || [], range);

  const firm = aggregateMatters(filtered);
  const byPractice = groupAggregate(filtered, m => m.practiceArea);

  const partnerById = new Map(partners.map(p => [p.id, p]));
  const byPartner = groupAggregate(filtered, m => m.leadPartner)
    .map(row => ({ ...row, name: partnerById.get(row.key)?.name || row.key }))
    .slice(0, 10);

  const clientById = new Map(clients.map(c => [c.id, c]));
  const bySector = groupAggregate(filtered, m => clientById.get(m.client)?.sector || null)
    .slice(0, 10);

  const byClient = groupAggregate(filtered, m => m.client)
    .map(row => ({ ...row, name: clientById.get(row.key)?.legalName || row.key }))
    .slice(0, 10);

  return {
    range,
    fxBase: 'GBP',
    fxAsOf: '2026-05-15',
    firm,
    byPractice,
    byPartner,
    bySector,
    byClient
  };
}
