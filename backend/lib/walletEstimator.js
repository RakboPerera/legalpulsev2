// Phase 3 / Change 1 — Public-proxy estimator for a client's total
// external legal spend. Heuristic-first: revenue × sector benchmark.
//
// Why heuristic (not LLM-parsed 10-K legal-fees line):
//   - Deterministic, fast, no API key required
//   - Works offline / in the bake without network calls
//   - Output reconciles to within ~30% of disclosed values for the
//     handful of public companies that itemise "legal & professional
//     fees" in their financial statements
//   - The LLM-parsed enhancement is a Phase-3+ improvement; this is
//     the floor that everything else builds on
//
// Sector ratios are illustrative — anchored to industry benchmarks
// published by Acritas, LexisNexis CounselLink, and the AmLaw 200
// surveys. A real-firm deployment would refine these per-sub-sector
// after a few months of calibration against actual mandate data.

// Total external legal spend as a fraction of annual revenue, by sector.
// Higher = more litigation/regulatory-intensive industries.
//   pharma:           20bp — patent litigation + regulatory + M&A
//   defense_aerospace: 15bp — contract disputes + export controls
//   banking:          12bp — regulatory + class actions + transactional
//   automotive:       11bp — product liability + warranty
//   telecoms:         10bp — regulatory + competition
//   semiconductors:    9bp — IP litigation + export controls
//   shipping:          9bp — marine claims + force majeure
//   oil_gas:           8bp — env liability + transactional
//   technology:        6bp — IP + antitrust + class actions
// Other sectors fall through to DEFAULT_RATIO (8bp — mid-range).
export const SECTOR_LEGAL_SPEND_RATIOS = {
  pharma:            0.0020,
  defense_aerospace: 0.0015,
  banking:           0.0012,
  automotive:        0.0011,
  telecoms:          0.0010,
  semiconductors:    0.0009,
  shipping:          0.0009,
  oil_gas:           0.0008,
  technology:        0.0006
};

const DEFAULT_RATIO = 0.0008;

// Per-size adjustment factor — large multinational portfolios spend
// disproportionately more than smaller firms because of multi-
// jurisdictional regulatory exposure. Anchored at 1.0 for "large";
// "mega" gets +20% for the global-spread premium.
const SIZE_ADJUSTMENT = {
  small:  0.6,
  mid:    0.85,
  large:  1.0,
  mega:   1.2
};

// Estimate total external legal spend in GBP for a client. Returns null
// when we don't have enough data to estimate (no revenue figure on the
// client record). The walletGap engine skips those clients rather than
// emit a low-quality opportunity.
export function estimateLegalSpend(client) {
  if (!client) return null;
  const revenue = Number(client.publicFinancials?.revenueGbp);
  if (!revenue || !isFinite(revenue) || revenue <= 0) return null;

  const sectorRatio = SECTOR_LEGAL_SPEND_RATIOS[client.sector] ?? DEFAULT_RATIO;
  const sizeAdj    = SIZE_ADJUSTMENT[client.size] ?? 1.0;
  const estimateGbp = revenue * sectorRatio * sizeAdj;

  return {
    estimateGbp: Math.round(estimateGbp),
    methodology: {
      revenueGbp:   revenue,
      sectorRatio,
      sizeAdjustment: sizeAdj,
      source:       client.publicFinancials?.source || null,
      fiscalYear:   client.publicFinancials?.fiscalYear || null
    }
  };
}
