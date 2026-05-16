// Client / prospect worthiness scorer — the "is this entity worth pursuing?"
// lens that surfaces alongside every model-produced opportunity.
//
// Three components (clients) or two (prospects, no matter history):
//
//   1. Profitability — derived from the client's matter financials
//      (margin, realisation, write-off, payment days). Clients only.
//   2. Business health — derived from this entity's risk flags + the
//      recent significant signals tagged against them.
//   3. Credit risk — derived from the published credit rating + outlook.
//
// All three sub-scores land on a 0-100 scale. The aggregate uses the firm's
// worthinessWeights (default 0.40 / 0.30 / 0.30). Prospects get a 50/50 blend
// of health + credit and a 2-of-3 marker on the surfaced object so the
// banner UI can label itself honestly.
//
// Pure functions: no DB, no LLM, no I/O. Same architecture as the KPI +
// Operational Insights helpers.

const FX_TO_GBP = { GBP: 1.0, USD: 0.79, EUR: 0.85 };
const ACTIVE_STATUSES = new Set(['active', 'in_progress', 'open']);

const DEFAULT_WEIGHTS = { profitability: 0.40, health: 0.30, credit: 0.30 };

const TIER_THRESHOLDS = { high: 75, medium: 60, low: 40 };

const RISK_FLAG_PENALTIES = {
  distressed:          25,
  regulatory_pressure: 10,
  litigation_heavy:    8,
  sanctions_adjacent:  10,
  esg_pressure:        5,
  going_concern:       30
};

// S&P-style rating → score map. Approximate; tuned so investment-grade lands
// in 60+ and speculative grade lands below 50.
const RATING_SCORE = {
  AAA:  100,
  'AA+': 92, AA:  88, 'AA-': 85,
  'A+':  80, A:   75, 'A-':  70,
  'BBB+': 62, BBB: 55, 'BBB-': 48,
  'BB+':  38, BB:  32, 'BB-':  28,
  'B+':   22, B:   18, 'B-':   15,
  CCC:   10, CC:   5,  C:     3,
  D:      0,
  NR:    50  // not rated → neutral, not penalised
};

function gbp(amount, currency) {
  return (Number(amount) || 0) * (FX_TO_GBP[currency || 'GBP'] ?? 1.0);
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

function tierFor(score) {
  if (score == null) return 'unknown';
  if (score >= TIER_THRESHOLDS.high)   return 'high';
  if (score >= TIER_THRESHOLDS.medium) return 'medium';
  if (score >= TIER_THRESHOLDS.low)    return 'low';
  return 'avoid';
}

// ----- Profitability -----
// Read this client's matters. Roll up margin / realisation / write-off / DSO
// across closed matters; weight by GBP volume (so a £6M matter at 35% margin
// dominates a £200k matter at 15%). Active matters are excluded from the
// realisation + DSO calculation because their feesCollected is a partial
// snapshot (50% of feesBilled by seed convention) — including them would
// drag a perfectly fine client's score down for no commercial reason.
function scoreProfitability(matters) {
  const closed = (matters || []).filter(m => !ACTIVE_STATUSES.has(m.status) && m.feesBilled);
  if (!closed.length) return { score: null, drivers: [], cautions: [], detail: { matterCount: 0 } };

  let weightedMargin = 0, weightedRealisation = 0, weightedWriteOff = 0;
  let totalFeesBilled = 0, totalWorkedValue = 0, totalCollected = 0;
  const dsoSamples = [];
  for (const m of closed) {
    const fb = gbp(m.feesBilled, m.currency);
    const wv = gbp(m.workedValue, m.currency);
    const fc = gbp(m.feesCollected, m.currency);
    const dc = gbp(m.directCost, m.currency);
    if (fb <= 0) continue;
    const margin      = (fb - dc) / fb;
    const realisation = fb > 0 ? fc / fb : 0;
    const writeOff    = wv > 0 ? (wv - fb) / wv : 0;
    weightedMargin      += margin * fb;
    weightedRealisation += realisation * fb;
    weightedWriteOff    += writeOff * fb;
    totalFeesBilled  += fb;
    totalWorkedValue += wv;
    totalCollected   += fc;
    if (typeof m.paymentDays === 'number') dsoSamples.push(m.paymentDays);
  }

  if (totalFeesBilled <= 0) return { score: null, drivers: [], cautions: [], detail: { matterCount: closed.length } };

  const avgMargin      = weightedMargin / totalFeesBilled;     // 0 to 1
  const avgRealisation = weightedRealisation / totalFeesBilled;
  const avgWriteOff    = weightedWriteOff / totalFeesBilled;
  const avgDso         = dsoSamples.length
    ? dsoSamples.reduce((s, d) => s + d, 0) / dsoSamples.length
    : null;

  // Scale each metric to 0-100. Anchors:
  //   margin:      15% → 0,  40% → 100
  //   realisation: 75% → 0,  95% → 100
  //   write-off:   20% → 0,   3% → 100  (inverted — lower is better)
  //   dso:        120d → 0,  30d → 100  (inverted)
  const marginScore      = clamp((avgMargin      - 0.15) / (0.40 - 0.15) * 100, 0, 100);
  const realisationScore = clamp((avgRealisation - 0.75) / (0.95 - 0.75) * 100, 0, 100);
  const writeOffScore    = clamp((0.20 - avgWriteOff)    / (0.20 - 0.03) * 100, 0, 100);
  const dsoScore         = avgDso != null
    ? clamp((120 - avgDso) / (120 - 30) * 100, 0, 100)
    : 60; // neutral mid score when no DSO data

  // Weighted composite: margin matters most, then realisation, then DSO,
  // then write-off (which is partly redundant with realisation).
  const composite = (
    marginScore      * 0.40 +
    realisationScore * 0.25 +
    dsoScore         * 0.20 +
    writeOffScore    * 0.15
  );

  // Volume bonus — log-scaled. £1m lifetime fees adds nothing; £20m+ adds
  // up to +6 points. Keeps small-spend clients from being penalised
  // structurally while still rewarding the firm's anchor relationships.
  const volumeBonus = clamp((Math.log10(totalFeesBilled / 1e6) - 0.0) * 3, 0, 6);
  const score = clamp(composite + volumeBonus, 0, 100);

  // Drivers + cautions — short, partner-readable.
  const drivers = [];
  const cautions = [];
  drivers.push(`${closed.length} closed matter${closed.length === 1 ? '' : 's'} totalling £${(totalFeesBilled / 1e6).toFixed(1)}M`);
  drivers.push(`Avg margin ${(avgMargin * 100).toFixed(0)}%${avgMargin >= 0.30 ? ' — clean economics' : avgMargin >= 0.22 ? '' : ' — below firm target'}`);
  if (avgRealisation >= 0.88) {
    drivers.push(`Realisation ${(avgRealisation * 100).toFixed(0)}%`);
  } else if (avgRealisation < 0.80) {
    cautions.push(`Realisation only ${(avgRealisation * 100).toFixed(0)}% — pricing or write-down pattern worth review`);
  }
  if (avgDso != null) {
    if (avgDso <= 60) drivers.push(`Paid within ${Math.round(avgDso)} days on average`);
    else if (avgDso <= 90) cautions.push(`Average DSO ${Math.round(avgDso)} days — slower than firm target`);
    else cautions.push(`Average DSO ${Math.round(avgDso)} days — chronic late payer`);
  }
  if (avgWriteOff >= 0.15) {
    cautions.push(`Write-off rate ${(avgWriteOff * 100).toFixed(0)}% — fees billed materially below worked value`);
  }

  return {
    score: Math.round(score),
    drivers,
    cautions,
    detail: {
      matterCount: closed.length,
      avgMargin,
      avgRealisation,
      avgWriteOff,
      avgDso,
      totalFeesBilledGbp: Math.round(totalFeesBilled)
    }
  };
}

// ----- Business health -----
// Start at 70 (neutral) and walk down for visible risk signals. The seed
// already classifies the broad strokes via riskFlags on each entity — that
// list does most of the work. Recent legally-significant signals tagged
// against the entity in the workspace bias the score further.
function scoreHealth(entity, signalsForEntity = []) {
  let score = 70;
  const drivers = [];
  const cautions = [];

  const flags = entity.riskFlags || [];
  if (!flags.length) {
    drivers.push('No active risk flags');
    score += 10;
  } else {
    for (const flag of flags) {
      const penalty = RISK_FLAG_PENALTIES[flag] ?? 5;
      score -= penalty;
      const human = flag.replace(/_/g, ' ');
      cautions.push(`Flag: ${human}`);
    }
  }

  if (entity.creditOutlook === 'negative') {
    score -= 8;
    cautions.push('Credit outlook negative');
  } else if (entity.creditOutlook === 'positive') {
    score += 5;
  }

  // High-volume legally-significant signal stream = lots of "stuff happening"
  // around this entity. Cuts both ways — could be opportunity, could be
  // distress. We bias slightly negative because the entity is more exposed.
  const sigCount = (signalsForEntity || []).filter(s => s.isLegallySignificant).length;
  if (sigCount >= 8) {
    score -= 5;
    cautions.push(`${sigCount} recent legal-significant signals — elevated exposure`);
  } else if (sigCount > 0 && sigCount < 8) {
    drivers.push(`${sigCount} recent legal-significant signal${sigCount === 1 ? '' : 's'}`);
  }

  return {
    score: clamp(Math.round(score), 0, 100),
    drivers,
    cautions,
    detail: { riskFlags: flags, creditOutlook: entity.creditOutlook, signalCount: sigCount }
  };
}

// ----- Credit risk -----
function scoreCredit(entity) {
  const rating = entity.creditRating || 'NR';
  const base = RATING_SCORE[rating] ?? 50;
  const outlook = entity.creditOutlook || 'stable';
  const outlookAdj = outlook === 'positive' ? 5 : outlook === 'negative' ? -10 : 0;
  const score = clamp(base + outlookAdj, 0, 100);

  const drivers = [];
  const cautions = [];
  if (rating === 'NR') {
    cautions.push('Not publicly rated — no third-party credit signal available');
  } else if (base >= 70) {
    drivers.push(`Credit rating ${rating} ${outlook}`);
  } else if (base >= 48) {
    drivers.push(`Credit rating ${rating} ${outlook} — investment grade`);
  } else {
    cautions.push(`Credit rating ${rating} ${outlook} — speculative grade, pre-engagement diligence advised`);
  }
  if (outlook === 'negative' && base >= 48) {
    cautions.push('Negative outlook — credit pressure expected over the next cycle');
  }

  return { score: Math.round(score), drivers, cautions, detail: { rating, outlook } };
}

// ----- Aggregate -----
export function scoreEntityWorthiness({ entity, matters = [], signals = [], weights = DEFAULT_WEIGHTS, now = Date.now() }) {
  if (!entity) return null;
  const isProspect = (entity.id || '').startsWith('pr-');

  const credit = scoreCredit(entity);
  const health = scoreHealth(entity, signals);

  let profitability = null;
  if (!isProspect) {
    profitability = scoreProfitability(matters);
  }

  // Aggregate. For prospects with no profitability sub-score we redistribute
  // the profitability weight 50/50 across health + credit.
  let overall;
  let componentsUsed;
  if (isProspect || profitability?.score == null) {
    overall = Math.round(0.50 * health.score + 0.50 * credit.score);
    componentsUsed = 2;
  } else {
    const w = { ...DEFAULT_WEIGHTS, ...(weights || {}) };
    overall = Math.round(
      w.profitability * profitability.score +
      w.health        * health.score +
      w.credit        * credit.score
    );
    componentsUsed = 3;
  }

  // Verdict line — a one-sentence summary the partner can read at a glance.
  const tier = tierFor(overall);
  let verdict;
  if (tier === 'high')      verdict = isProspect ? 'Strong target — pursue.' : 'Strong relationship — pursue.';
  else if (tier === 'medium') verdict = 'Pursue with care — see cautions.';
  else if (tier === 'low')  verdict = 'Hold — commercial profile is weak.';
  else                      verdict = 'Avoid — material concerns flagged.';

  return {
    entityId:    entity.id,
    entityName:  entity.legalName,
    entityType:  isProspect ? 'prospect' : 'client',
    overall,
    tier,
    verdict,
    componentsUsed,
    weights:     isProspect ? { health: 0.50, credit: 0.50 } : { ...DEFAULT_WEIGHTS, ...(weights || {}) },
    profitability,
    health,
    credit,
    generatedAt: new Date(now).toISOString()
  };
}

// Convenience helper — fetches the matters + signals for an entity from a
// workspace state and scores. Used by routes that take just (workspace, entityId).
export function scoreEntityFromWorkspace(workspace, entityId, opts = {}) {
  const entity = (workspace.clients || []).find(c => c.id === entityId)
              || (workspace.prospects || []).find(p => p.id === entityId);
  if (!entity) return null;
  const matters = (workspace.matters || []).filter(m => m.client === entityId);
  const signals = (workspace.signals || []).filter(s =>
    (s.entities || []).some(e => e.entityId === entityId));
  return scoreEntityWorthiness({
    entity, matters, signals,
    weights: workspace.firmProfile?.worthinessWeights,
    ...opts
  });
}
