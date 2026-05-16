// Derive opportunity severity (p0 / p1 / p2 / p3) — magnitude of legal exposure,
// independent of urgency. Used by heuristic engines that don't go through the
// LLM opportunityComposer (which produces severity directly). Keeps engine-
// generated and bake-time opps consistent in the UI's severity chip + filter.
//
//   p0 — bet-the-company. Reserved for sanctions hits, criminal exposure.
//   p1 — material. Urgent + high-confidence event-driven exposure.
//   p2 — standard. Typical opportunity.
//   p3 — watching brief. Cross-sell, low-confidence prospect, steady-state.
export function deriveSeverity({ urgencyTier, confidence, engine, signalSources }) {
  // Sanctions / criminal triggers escalate to p0 regardless of urgency.
  const SANCTIONS = new Set(['ofac_sdn', 'eu_sanctions', 'uk_ofsi', 'sanctions_cross_ref']);
  if (Array.isArray(signalSources) && signalSources.some(s => SANCTIONS.has(s))) {
    return 'p0';
  }
  const conf = typeof confidence === 'number' ? confidence : 0.5;
  // Cross-sell + prospect-discovery are opportunity surfacing, not exposure
  // detection — default low magnitude. Event-driven derives from urgency.
  if (engine === 'cross_sell' || engine === 'prospect_discovery') {
    return conf >= 0.8 ? 'p2' : 'p3';
  }
  if (urgencyTier === 'immediate' || urgencyTier === 'urgent') return 'p1';
  if (urgencyTier === 'this_week') return conf >= 0.7 ? 'p1' : 'p2';
  if (urgencyTier === 'this_month') return 'p2';
  return 'p3';
}
