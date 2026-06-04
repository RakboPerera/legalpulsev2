// Frontend mirror of the constants used by the wallet-gap engine. Kept
// hardcoded (rather than fetched over the API) because the values are
// stable, small, and shipping them in the bundle costs nothing. If
// these ever drift from the backend, that's documentation drift, not
// a functional bug — the engine still uses the canonical values.
//
// Sources of truth:
//   backend/lib/walletEstimator.js — SECTOR_LEGAL_SPEND_RATIOS, SIZE_ADJUSTMENT
//   backend/lib/walletGap.js        — FX_TO_GBP, trailing-12m window
//   backend/engines/walletGap.js    — gap floor + share ceiling

// Sector benchmark ratios (% of revenue). Anchored to industry surveys
// — Acritas, LexisNexis CounselLink, AmLaw 200 — and reflective of
// where each industry concentrates its external-legal spend.
export const SECTOR_RATIOS = [
  { sector: 'pharma',            label: 'Pharma',                    bp: 20, rationale: 'patent litigation + regulatory + M&A' },
  { sector: 'defense_aerospace', label: 'Defense & Aerospace',       bp: 15, rationale: 'contract disputes + export controls' },
  { sector: 'banking',           label: 'Banking',                   bp: 12, rationale: 'regulatory + class actions + transactional' },
  { sector: 'automotive',        label: 'Automotive',                bp: 11, rationale: 'product liability + warranty' },
  { sector: 'telecoms',          label: 'Telecoms',                  bp: 10, rationale: 'regulatory + competition' },
  { sector: 'semiconductors',    label: 'Semiconductors',            bp:  9, rationale: 'IP litigation + export controls' },
  { sector: 'shipping',          label: 'Shipping',                  bp:  9, rationale: 'marine claims + force majeure' },
  { sector: 'oil_gas',           label: 'Oil & Gas',                 bp:  8, rationale: 'env liability + transactional' },
  { sector: 'technology',        label: 'Technology',                bp:  6, rationale: 'IP + antitrust + class actions' }
];

// Default ratio used when a client's sector isn't in the lookup above.
export const DEFAULT_SECTOR_RATIO_BP = 8;

// Size adjustment multiplier. Mega-caps spend disproportionately more
// because of multi-jurisdictional regulatory + cross-border exposure;
// small caps spend less because they consolidate work with fewer firms.
export const SIZE_ADJUSTMENTS = [
  { size: 'small', multiplier: 0.6,  label: 'Small',           rationale: 'simpler legal profile; fewer external firms' },
  { size: 'mid',   multiplier: 0.85, label: 'Mid-cap',         rationale: 'between small and large' },
  { size: 'large', multiplier: 1.0,  label: 'Large',           rationale: 'baseline (1.0×) for the benchmark' },
  { size: 'mega',  multiplier: 1.2,  label: 'Mega-cap',        rationale: '+20% for the global-spread premium' }
];

// FX rates used to normalise per-matter feesBilled (which can be in
// USD or EUR) into GBP for the wallet-gap math. Static for the demo;
// a real-firm deployment would pull from a market-data feed with
// an as-of timestamp.
export const FX_RATES = [
  { currency: 'GBP', toGbp: 1.00, note: 'base currency' },
  { currency: 'USD', toGbp: 0.79, note: 'approximate FY24 cross-rate' },
  { currency: 'EUR', toGbp: 0.85, note: 'approximate FY24 cross-rate' }
];

// Trailing-12m definition for the internalBilled denominator.
export const TRAILING_12M = {
  windowDays: 365,
  includesActive: true,
  rule: 'Active and in-progress matters always count. Closed matters count if their endDate is within the last 365 days. Matches the KPI Dashboard\'s 12m range filter.'
};

// Engine filter thresholds — control which clients surface as
// wallet-gap opportunities on the board.
export const ENGINE_THRESHOLDS = {
  gapFloorGbp: 500_000,      // skip clients whose gap < £500k
  shareCeilingPct: 0.60,     // skip clients where firm already captures ≥60%
  rule: 'A wallet-gap opportunity is emitted for a client only when (gap > £500k) AND (current wallet share < 60%). Clients above the share ceiling are already deeply penetrated; clients below the gap floor are not worth a partner conversation.'
};

// Caveats — partner-readable, sets accuracy expectations.
export const CAVEATS = [
  'Heuristic-only. The math is deterministic and reproducible, but each output is a best-fit estimate, not a measurement.',
  'The deck-promised next step is LLM-parsed extraction of the actual "legal & professional fees" line item from each client\'s most recent annual filing — replacing the sector × revenue heuristic with a per-client figure. Out of scope for this build.',
  'Sector ratios are anchored to broad industry benchmarks (Acritas / CounselLink / AmLaw 200). A real-firm deployment would refine ratios per sub-sector after a few months of calibration against the firm\'s actual mandate data.',
  'FX rates are static for the demo. A live deployment would pull rates from a market-data feed with an as-of date stamped on every wallet figure.'
];
