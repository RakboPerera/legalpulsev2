// Workspace calibration — the dials a firm admin can turn to shape how
// the engines and dashboards behave for their own deployment. Five
// surfaces:
//   1. worthiness   — weights + tier thresholds + risk-flag penalties
//   2. operational  — overrun / margin / stale thresholds
//   3. walletGap    — engine filters + capture rate
//   4. estimator    — sector ratios + size multipliers
//   5. fxAndTiming  — FX rates + trailing window
//
// Stored as a partial JSON blob on workspace.calibration. Reads merge
// the partial override with the defaults below — so a brand-new
// workspace works with zero calibration data and an existing one only
// has to persist the keys the admin actually changed.

export const DEFAULTS = {
  worthiness: {
    // Component weights — must sum to 1.0 across the three. If a user
    // saves a set that doesn't sum to 1.0, the backend normalises so
    // the math stays honest.
    weights: { profitability: 0.40, health: 0.30, credit: 0.30 },
    // Tier boundaries. A score ≥ high → PURSUE; ≥ medium → PURSUE WITH
    // CARE; ≥ low → HOLD; else AVOID.
    tierThresholds: { high: 75, medium: 60, low: 40 },
    // Per-risk-flag penalty applied to the Business Health sub-score.
    // Higher number = bigger hit. The flag IDs match those in the seed
    // entities' riskFlags array.
    riskFlagPenalties: {
      distressed:          25,
      regulatory_pressure: 10,
      litigation_heavy:    8,
      sanctions_adjacent:  10,
      esg_pressure:        5,
      going_concern:       30
    }
  },
  operational: {
    // Operational Insights exception thresholds. Same defaults the
    // route already applies; this surfaces them in the UI.
    budgetThreshold: 0.10,   // matters > 10% over budget flagged
    marginThreshold: 0.20,   // matters with margin < 20% flagged
    staleDays:       60      // active matters idle ≥ 60d flagged
  },
  walletGap: {
    // Engine filter — only emit a wallet-gap opportunity when there's
    // meaningful upside left AND the firm doesn't already dominate.
    gapFloorGbp:     500_000,
    shareCeilingPct: 0.60,
    // What proportion of the gap the firm could plausibly capture if
    // it pursues — drives the opportunity's `estimatedRevenue` field.
    captureRatePct:  0.25
  },
  estimator: {
    // Sector benchmark ratios — % of revenue spent on external legal.
    // Stored as fractions (0.0020 = 20 bp). Adding a new sector here
    // automatically makes it usable by the estimator.
    sectorRatios: {
      pharma:            0.0020,
      defense_aerospace: 0.0015,
      banking:           0.0012,
      automotive:        0.0011,
      telecoms:          0.0010,
      semiconductors:    0.0009,
      shipping:          0.0009,
      oil_gas:           0.0008,
      technology:        0.0006
    },
    defaultSectorRatio: 0.0008,
    // Size adjustment multipliers — applied on top of sector ratio.
    sizeAdjustment: {
      small: 0.60,
      mid:   0.85,
      large: 1.00,
      mega:  1.20
    }
  },
  fxAndTiming: {
    // FX → GBP. Static for the demo; a production deployment pulls
    // from a market-data feed and stamps each figure with an as-of.
    fxToGbp: { GBP: 1.00, USD: 0.79, EUR: 0.85 },
    // "Trailing 12 months" used by the wallet-gap internal-billed
    // denominator and the KPI dashboard's 12m range filter.
    trailingWindowDays: 365
  }
};

// Deep merge — workspace overrides win, defaults fill the rest. Only
// goes one level deep into the section objects (which is all the
// schema needs); arrays + scalars are replaced wholesale.
export function getEffectiveCalibration(workspace) {
  const override = workspace?.calibration || {};
  const out = {};
  for (const section of Object.keys(DEFAULTS)) {
    const def = DEFAULTS[section];
    const ov  = override[section] || {};
    const merged = { ...def };
    for (const key of Object.keys(ov)) {
      const ovVal = ov[key];
      // Nested objects (sectorRatios, weights, tierThresholds, etc.)
      // merge by key so a partial override of one rating doesn't
      // wipe the rest.
      if (def[key] && typeof def[key] === 'object' && !Array.isArray(def[key])) {
        merged[key] = { ...def[key], ...ovVal };
      } else {
        merged[key] = ovVal;
      }
    }
    out[section] = merged;
  }
  return out;
}

// Validate an incoming calibration payload. Coerces numbers, clamps
// to sane bounds, and returns a normalised override blob to store.
// Anything missing or unknown is dropped silently — the schema is
// strict.
export function normalizeCalibration(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;

  // --- worthiness ---
  if (input.worthiness) {
    out.worthiness = {};
    const w = input.worthiness;
    if (w.weights) {
      const wt = {
        profitability: clamp01(w.weights.profitability),
        health:        clamp01(w.weights.health),
        credit:        clamp01(w.weights.credit)
      };
      // Re-normalise so the three sum to 1.0. Avoids silent drift
      // when a user enters 0.5 / 0.3 / 0.3 (totals 1.1) by hand.
      const sum = wt.profitability + wt.health + wt.credit;
      if (sum > 0) {
        out.worthiness.weights = {
          profitability: round3(wt.profitability / sum),
          health:        round3(wt.health / sum),
          credit:        round3(wt.credit / sum)
        };
      }
    }
    if (w.tierThresholds) {
      out.worthiness.tierThresholds = {
        high:   clampInt(w.tierThresholds.high,   0, 100),
        medium: clampInt(w.tierThresholds.medium, 0, 100),
        low:    clampInt(w.tierThresholds.low,    0, 100)
      };
    }
    if (w.riskFlagPenalties && typeof w.riskFlagPenalties === 'object') {
      out.worthiness.riskFlagPenalties = {};
      for (const [k, v] of Object.entries(w.riskFlagPenalties)) {
        const num = Number(v);
        if (isFinite(num) && num >= 0 && num <= 100) {
          out.worthiness.riskFlagPenalties[k] = num;
        }
      }
    }
  }

  // --- operational ---
  if (input.operational) {
    const o = input.operational;
    out.operational = {
      budgetThreshold: clampNum(o.budgetThreshold, 0, 1, DEFAULTS.operational.budgetThreshold),
      marginThreshold: clampNum(o.marginThreshold, 0, 1, DEFAULTS.operational.marginThreshold),
      staleDays:       clampInt(o.staleDays,       1, 365, DEFAULTS.operational.staleDays)
    };
  }

  // --- walletGap ---
  if (input.walletGap) {
    const g = input.walletGap;
    out.walletGap = {
      gapFloorGbp:     clampNum(g.gapFloorGbp,     0, 1e12, DEFAULTS.walletGap.gapFloorGbp),
      shareCeilingPct: clampNum(g.shareCeilingPct, 0, 1,    DEFAULTS.walletGap.shareCeilingPct),
      captureRatePct:  clampNum(g.captureRatePct,  0, 1,    DEFAULTS.walletGap.captureRatePct)
    };
  }

  // --- estimator (sector ratios + size multipliers) ---
  if (input.estimator) {
    const e = input.estimator;
    out.estimator = {};
    if (e.sectorRatios && typeof e.sectorRatios === 'object') {
      out.estimator.sectorRatios = {};
      for (const [k, v] of Object.entries(e.sectorRatios)) {
        const num = Number(v);
        if (isFinite(num) && num >= 0 && num <= 0.1) { // 0–1000 bp range
          out.estimator.sectorRatios[k] = num;
        }
      }
    }
    if (e.defaultSectorRatio != null) {
      out.estimator.defaultSectorRatio = clampNum(e.defaultSectorRatio, 0, 0.1, DEFAULTS.estimator.defaultSectorRatio);
    }
    if (e.sizeAdjustment && typeof e.sizeAdjustment === 'object') {
      out.estimator.sizeAdjustment = {};
      for (const [k, v] of Object.entries(e.sizeAdjustment)) {
        const num = Number(v);
        if (isFinite(num) && num >= 0 && num <= 5) {
          out.estimator.sizeAdjustment[k] = num;
        }
      }
    }
  }

  // --- fxAndTiming ---
  if (input.fxAndTiming) {
    const f = input.fxAndTiming;
    out.fxAndTiming = {};
    if (f.fxToGbp && typeof f.fxToGbp === 'object') {
      out.fxAndTiming.fxToGbp = {};
      for (const [k, v] of Object.entries(f.fxToGbp)) {
        const num = Number(v);
        if (isFinite(num) && num > 0 && num < 100) {
          out.fxAndTiming.fxToGbp[k] = num;
        }
      }
    }
    if (f.trailingWindowDays != null) {
      out.fxAndTiming.trailingWindowDays = clampInt(f.trailingWindowDays, 1, 3650, DEFAULTS.fxAndTiming.trailingWindowDays);
    }
  }

  return out;
}

function clamp01(v) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
function clampNum(v, lo, hi, fallback) {
  const n = Number(v);
  if (!isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}
function clampInt(v, lo, hi, fallback = lo) {
  const n = parseInt(v, 10);
  if (!isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}
function round3(n) {
  return Math.round(n * 1000) / 1000;
}
