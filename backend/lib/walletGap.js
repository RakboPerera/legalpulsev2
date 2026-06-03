// Phase 3 / Change 1 — Wallet-share gap computation.
//
// Given a client + their matter history with the firm, compute:
//   internalBilledGbp  — what the firm has billed this client over the
//                        trailing 12 months (FX-normalised to GBP)
//   estimatedTotalGbp  — what the client likely spends on external
//                        legal in total (from walletEstimator.js)
//   walletSharePct     — internal / estimated
//   gapGbp             — estimated − internal (how much is on the table)
//   gapByPracticeArea  — practice areas the firm covers but hasn't
//                        billed THIS client for (the natural attack lanes)
//
// Pure function — no I/O, no LLM, no mutation. The engine wrapping
// this is in backend/engines/walletGap.js; the KPI aggregator at
// backend/lib/kpiAggregator.js consumes the same per-client roll-up
// to surface firm-wide tiles.

import { estimateLegalSpend } from './walletEstimator.js';

const FX_TO_GBP = { GBP: 1.0, USD: 0.79, EUR: 0.85 };
const ACTIVE_STATUSES = new Set(['active', 'in_progress', 'open']);

function gbp(amount, currency) {
  const rate = FX_TO_GBP[currency || 'GBP'] ?? 1.0;
  return (Number(amount) || 0) * rate;
}

// 365-day window for "trailing 12 months". A matter contributes its
// feesBilled to the trailing total if (a) it's still active OR (b) it
// closed within the last 365 days. Same convention as the KPI
// dashboard's '12m' range filter for consistency.
function isWithinTrailing12m(matter, nowMs) {
  if (ACTIVE_STATUSES.has(matter.status)) return true;
  const endTs = matter.endDate ? new Date(matter.endDate).getTime() : null;
  return !!(endTs && (nowMs - endTs) <= 365 * 86_400_000);
}

// Practice areas the firm covers across its full matter ledger. Used
// to identify "white-space" practices — areas the firm has experience
// in but hasn't billed THIS client for.
function deriveFirmPracticeAreas(allMatters) {
  const set = new Set();
  for (const m of allMatters || []) {
    if (m.practiceArea) set.add(m.practiceArea);
  }
  return set;
}

// Practice areas the firm has billed THIS client for. The complement
// against the firm-wide set is the wallet-gap white-space.
function deriveClientPracticeAreas(clientMatters) {
  const set = new Set();
  for (const m of clientMatters || []) {
    if (m.practiceArea) set.add(m.practiceArea);
  }
  return set;
}

// Compute the wallet-gap for one client. Returns null when we can't
// estimate (no public-finance data on the client). Returns an object
// with all the numerator/denominator parts so callers can render the
// breakdown, not just the headline gap figure.
export function computeWalletGap({ client, allMatters = [], nowMs = Date.now() }) {
  if (!client) return null;
  const estimate = estimateLegalSpend(client);
  if (!estimate) return null;

  const clientMatters = (allMatters || []).filter(m => m.client === client.id);

  // Trailing-12m internal-billed sum, GBP-normalised.
  let internalBilledGbp = 0;
  for (const m of clientMatters) {
    if (!isWithinTrailing12m(m, nowMs)) continue;
    internalBilledGbp += gbp(m.feesBilled, m.currency);
  }
  internalBilledGbp = Math.round(internalBilledGbp);

  const estimatedTotalGbp = estimate.estimateGbp;
  const gapGbp = Math.max(0, estimatedTotalGbp - internalBilledGbp);
  const walletSharePct = estimatedTotalGbp > 0 ? internalBilledGbp / estimatedTotalGbp : null;

  const firmPractices    = deriveFirmPracticeAreas(allMatters);
  const clientPractices  = deriveClientPracticeAreas(clientMatters);
  const gapByPracticeArea = [...firmPractices].filter(p => !clientPractices.has(p));

  return {
    clientId:           client.id,
    clientName:         client.legalName,
    sector:             client.sector,
    internalBilledGbp,
    estimatedTotalGbp,
    walletSharePct,
    gapGbp,
    gapByPracticeArea,
    methodology:        estimate.methodology
  };
}

// Roll-up across all clients in a workspace. Returns an array sorted
// by gapGbp descending plus firm-wide totals.
export function computeWalletGapPortfolio({ clients = [], matters = [], nowMs = Date.now() }) {
  const rows = [];
  let totalInternal = 0;
  let totalEstimated = 0;
  for (const client of clients) {
    const row = computeWalletGap({ client, allMatters: matters, nowMs });
    if (!row) continue;
    rows.push(row);
    totalInternal  += row.internalBilledGbp;
    totalEstimated += row.estimatedTotalGbp;
  }
  rows.sort((a, b) => b.gapGbp - a.gapGbp);

  const firmShare = totalEstimated > 0 ? totalInternal / totalEstimated : null;
  const firmGap   = Math.max(0, totalEstimated - totalInternal);

  return {
    rows,
    firm: {
      internalBilledGbp: totalInternal,
      estimatedTotalGbp: totalEstimated,
      walletSharePct:    firmShare,
      gapGbp:            firmGap,
      clientsWithEstimate: rows.length
    }
  };
}
