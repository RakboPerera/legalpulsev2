// Quality-gate filters shared between the bake script and the runtime
// engine route handlers. Before this module existed, the engines produced
// opportunities directly without sanctions pre-filtering or critic gating —
// only the bake had those guards. As a result, runtime engine runs surfaced
// opportunities that the bake would have dropped.
//
// Two filters are exposed:
//   - sanctionsPreFilter: deterministic, no LLM. Drops opps whose supporting
//     signals are all sanctions sources (compliance escalations, not BD opps).
//   - applyCritic: LLM-backed. Drops blocker-severity opps, demotes major
//     to capped-score with warning prepended, passes minor/none through.
//
// Both are pure functions of their inputs — module-level counters live in
// the bake script (telemetry), not here.

import { critiqueRecommendation } from '../agents/methodologyCritic.js';

const SANCTIONS_SOURCES = new Set(['ofac_sdn', 'eu_sanctions', 'uk_ofsi', 'sanctions_cross_ref']);

export function isSanctionsOnly(signals) {
  if (!Array.isArray(signals) || !signals.length) return false;
  return signals.every(s => SANCTIONS_SOURCES.has(s?.source));
}

// Drop opps whose entire signal pool is sanctions hits. These are compliance
// escalations to OFAC/OFSI desks, not business-development opportunities —
// surfacing them as cross-sell or prospect-discovery is misleading and routes
// them away from the team that actually handles them.
export function sanctionsPreFilter({ signals }) {
  return isSanctionsOnly(signals);
}

// Critic gate. Returns:
//   - { drop: true } when severity = 'blocker'
//   - { drop: false, demoted: true, opp } when severity = 'major' — score
//     capped at 30, confidence capped at 0.4, warning prepended to summary
//   - { drop: false, demoted: false, opp } for minor / none (pass through)
// Critic failures are non-fatal — the original opp passes through so a
// transient LLM error doesn't suppress every result.
export async function applyCritic(opp, ctx = {}) {
  let critique;
  try {
    critique = await critiqueRecommendation(opp, ctx);
  } catch (err) {
    // Telemetry left to the caller — return the opp untouched.
    return { drop: false, demoted: false, opp, critiqueError: err.message };
  }
  const sev = critique?.severity || 'none';
  if (sev === 'blocker') return { drop: true, critique };
  if (sev === 'major') {
    const issue = (critique.issues || [])[0]?.slice(0, 120) || 'major methodology issue';
    const demoted = {
      ...opp,
      score: Math.min(opp.score ?? 30, 30),
      confidence: Math.min(opp.confidence ?? 0.4, 0.4),
      basis: {
        ...(opp.basis || {}),
        summary: `[Critic flagged — review needed: ${issue}] ${opp.basis?.summary || ''}`,
        criticIssues: critique.issues || []
      }
    };
    return { drop: false, demoted: true, opp: demoted, critique };
  }
  return { drop: false, demoted: false, opp, critique };
}

// Convenience: run both filters in sequence. Returns null when the opp
// should be dropped, otherwise the (possibly demoted) opp.
//
// IMPORTANT: callers MUST pass `apiKey` and `provider` — without them the
// critic call silently fails (caught in applyCritic) and the opp passes
// through ungated. Before this signature change every runtime caller was
// passing only { signals, entity }, making the critic effectively a no-op
// in production. If you have no credentials available (e.g. a heuristic-
// only bake), pass `skipCritic: true` to opt out explicitly rather than
// have the call silently fail open.
export async function gateOpportunity(opp, { signals, entity, apiKey, provider, skipCritic = false } = {}) {
  if (sanctionsPreFilter({ signals })) return null;
  if (skipCritic) return opp;
  if (!apiKey || !provider) {
    // Fail loud — caller didn't thread credentials. This is a programming
    // error, not a runtime condition; if it ever fires in production it
    // means an engine forgot to pass req.user.providerApiKey through.
    console.warn('[gate] gateOpportunity called without apiKey/provider — critic skipped. This is a bug.');
    return opp;
  }
  const result = await applyCritic(opp, { entity, signals, apiKey, provider });
  if (result.drop) return null;
  return result.opp;
}
