// Deterministic financial-KPI backfill for data/seed/matters.json.
//
// Adds five new fields per matter — workedValue, feesCollected, directCost,
// budget, paymentDays — derived from the existing feesBilled + practiceArea +
// status. The numbers are deterministic on (matterId, metric) so re-runs are
// idempotent and the demo is reproducible.
//
// Per-practice baselines reflect plausible mid-tier UK legal market spreads:
//   - Tax / M&A: high margin, high realisation, low write-off, fast DSO
//   - Litigation / restructuring: lower margin, higher write-off, slower DSO
//   - Sanctions / IP: specialty premium
//
// Budget multipliers are intentionally spread [0.78, 1.10] so ~20% of matters
// overrun their budget by >10% — that exception list feeds the
// Operational Insights page.
//
// Run with:  node scripts/backfill-seed-kpis.js
// Re-running is safe — output is purely a function of matterId + practiceArea
// + status, so existing values are overwritten with identical values.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PRACTICE_BASELINES = {
  corporate_ma:             { margin: [0.30, 0.40], realisation: [0.88, 0.95], writeOff: [0.03, 0.08], dso: [45, 70] },
  banking_finance:          { margin: [0.25, 0.35], realisation: [0.88, 0.93], writeOff: [0.04, 0.10], dso: [35, 55] },
  litigation_disputes:      { margin: [0.18, 0.32], realisation: [0.82, 0.90], writeOff: [0.08, 0.18], dso: [60, 95] },
  regulatory_compliance:    { margin: [0.22, 0.32], realisation: [0.85, 0.92], writeOff: [0.06, 0.12], dso: [50, 75] },
  sanctions_trade:          { margin: [0.30, 0.40], realisation: [0.88, 0.94], writeOff: [0.04, 0.10], dso: [50, 70] },
  ip_technology:            { margin: [0.25, 0.35], realisation: [0.85, 0.92], writeOff: [0.05, 0.12], dso: [55, 80] },
  tax:                      { margin: [0.35, 0.45], realisation: [0.90, 0.95], writeOff: [0.03, 0.08], dso: [40, 60] },
  energy_natural_resources: { margin: [0.28, 0.38], realisation: [0.87, 0.93], writeOff: [0.05, 0.10], dso: [50, 75] },
  real_estate:              { margin: [0.18, 0.28], realisation: [0.85, 0.92], writeOff: [0.06, 0.12], dso: [60, 85] },
  restructuring_insolvency: { margin: [0.20, 0.32], realisation: [0.75, 0.88], writeOff: [0.10, 0.22], dso: [70, 120] }
};

const DEFAULT_BASELINE = { margin: [0.22, 0.32], realisation: [0.85, 0.92], writeOff: [0.06, 0.12], dso: [50, 80] };

// Stable 32-bit FNV-1a hash. Deterministic across runs / OSes / Node versions.
function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Pseudo-random in [0, 1) — different per (matterId, metric).
function hash01(matterId, metric) {
  return hash32(`${matterId}:${metric}`) / 0xFFFFFFFF;
}

function lerp(lo, hi, t) { return lo + (hi - lo) * t; }

function backfillMatter(m) {
  const baseline = PRACTICE_BASELINES[m.practiceArea] || DEFAULT_BASELINE;
  const margin      = lerp(baseline.margin[0],      baseline.margin[1],      hash01(m.id, 'margin'));
  const realisation = lerp(baseline.realisation[0], baseline.realisation[1], hash01(m.id, 'realisation'));
  const writeOff    = lerp(baseline.writeOff[0],    baseline.writeOff[1],    hash01(m.id, 'writeOff'));
  const dso         = Math.round(lerp(baseline.dso[0], baseline.dso[1],      hash01(m.id, 'dso')));

  const isActive = m.status === 'active' || m.status === 'in_progress' || m.status === 'open';
  const isLost   = m.status === 'closed_lost';

  // workedValue: what we'd have billed at standard rates with zero write-off.
  // feesBilled (existing) is the discounted invoice that actually went out.
  const workedValue = Math.round(m.feesBilled / (1 - writeOff));

  // Budget multiplier intentionally spread to introduce overruns.
  // [0.78, 1.10] means roughly the lower 30% of matters overrun their budget.
  const budget = Math.round(workedValue * lerp(0.78, 1.10, hash01(m.id, 'budget')));

  // feesCollected: full for closed-won/closed; partial for active; reduced for lost.
  let feesCollected;
  if (isActive)    feesCollected = Math.round(m.feesBilled * 0.50);
  else if (isLost) feesCollected = Math.round(m.feesBilled * realisation * 0.85);
  else             feesCollected = Math.round(m.feesBilled * realisation);

  const directCost = Math.round(m.feesBilled * (1 - margin));

  // paymentDays: null while still in flight; otherwise the DSO sample.
  const paymentDays = isActive ? null : dso;

  return {
    ...m,
    workedValue,
    feesCollected,
    directCost,
    budget,
    paymentDays,
    kpiSource: 'seed'
  };
}

const mattersPath = path.join(__dirname, '..', 'data', 'seed', 'matters.json');
const matters = JSON.parse(fs.readFileSync(mattersPath, 'utf8'));
const augmented = matters.map(backfillMatter);
fs.writeFileSync(mattersPath, JSON.stringify(augmented, null, 2) + '\n');

const overrunCount     = augmented.filter(m => m.feesBilled > m.budget * 1.10).length;
const unprofitableCnt  = augmented.filter(m => (m.feesBilled - m.directCost) / m.feesBilled < 0.20).length;
const totalFeesBilled  = augmented.reduce((s, m) => s + (m.feesBilled || 0), 0);
const totalWorkedValue = augmented.reduce((s, m) => s + (m.workedValue || 0), 0);
const firmWriteOff     = (totalWorkedValue - totalFeesBilled) / totalWorkedValue;

console.log(`[backfill] augmented ${augmented.length} matters with KPI fields`);
console.log(`[backfill]  → firm write-off rate:  ${(firmWriteOff * 100).toFixed(1)}%`);
console.log(`[backfill]  → matters >10% over budget:  ${overrunCount}  (${((overrunCount / augmented.length) * 100).toFixed(0)}% of total)`);
console.log(`[backfill]  → matters below 20% margin:  ${unprofitableCnt}  (${((unprofitableCnt / augmented.length) * 100).toFixed(0)}% of total)`);
