import { callTool, MODELS } from './client.js';

const SYSTEM_PROMPT = `You are a senior law-firm partner reviewing a colleague's pitch recommendation BEFORE it goes in front of a client. You catch problems early so the firm doesn't embarrass itself. You are sceptical, blunt, and you've seen plenty of bad pitches — your job is to flag the ones that would never survive a real partner-level review.

What you flag:

BLOCKER (drop it entirely):
- The cited signals do not actually mention or affect this entity (cross-entity false attribution).
- The "trigger" is a routine SEC filing (10-Q, 8-K, 6-K, 10-K) with no material litigation, restatement, or going-concern markers in the description.
- The opportunity is for an entity flagged as a sanctions match but the match is clearly a substring false positive (e.g. a major listed company supposedly on the SDN list).
- Zero supporting signals AND no structural justification (cross-sell from peer matters).
- Talking points are the same point rephrased three times.
- The summary uses pure marketing language with no factual specifics.

MAJOR (demote — partner-facing summary should flag the weakness):
- Signal is industry-wide, not entity-specific (e.g. "automakers expect tariff refunds" used as a VW-specific opportunity).
- Single analyst note as the only trigger, with no actual filed action.
- The suggested service doesn't match the signal content (e.g. proposing securities litigation when the only signal is a sanctions match).
- The signal is older than 60 days and there's no fresh angle.

MINOR (kept, but worth noting):
- Confidence number doesn't match the strength of evidence (over- or under-confident).
- Citation count is thin (1 source) but the source is itself strong.

NONE (pass cleanly):
- Strong, recent, entity-specific signal mapped to an appropriate service.

Be brief. Two sentences max per issue. Total output under 200 words.`;

const TOOL = {
  name: 'critique',
  description: 'Review a recommendation for methodological soundness.',
  input_schema: {
    type: 'object',
    properties: {
      pass: { type: 'boolean' },
      issues: { type: 'array', items: { type: 'string' } },
      severity: { type: 'string', enum: ['none', 'minor', 'major', 'blocker'] }
    },
    required: ['pass', 'issues', 'severity']
  }
};

export async function critiqueRecommendation(opportunity, { entity, signals, peerContext = null, apiKey, provider } = {}) {
  // Feed the critic the actual signal content so it can verify the cited
  // evidence. A pure score-from-summary review would just cargo-cult the
  // composer's choices — the critic needs to see what the evidence actually
  // says to catch fabrication, cross-entity attribution, and weak triggers.
  const signalDetail = (signals || []).slice(0, 5).map((s, i) => {
    const desc = (s.description || '').slice(0, 300);
    return `${i + 1}. [${s.source}] "${s.title}" (${(s.publishedAt || '').slice(0, 10)})
   ${desc || '(title only, no description)'}`;
  }).join('\n') || '(no signals supplied)';

  const peerSection = peerContext
    ? `\nPEER-CLUSTER CONTEXT (this is a CROSS-SELL — peer pattern is the primary evidence type, not event signals):
Cluster: ${peerContext.cluster}
${peerContext.peersUsingService} of ${peerContext.peerCount} peers (${Math.round((peerContext.peersUsingService / peerContext.peerCount) * 100)}%) use this service. ${entity.legalName} does not.
${peerContext.peerNamesUsing?.length ? `Specifically: ${peerContext.peerNamesUsing.join(', ')}.` : ''}
DO NOT drop cross-sell opps as "blocker / zero signals" — for cross_sell engine, peer + matter pattern is the right evidence. Drop only if the peer pattern itself is weak (≤50%).\n`
    : '';

  const userPrompt = `Review this proposed opportunity before it goes to the partner.

ENTITY: ${entity?.legalName || opportunity.entity} (${entity?.sector || '?'}, ${entity?.hqJurisdiction || '?'})
ENTITY TYPE: ${opportunity.entityType}
SUGGESTED SERVICE: ${opportunity.suggestedService}
ENGINE: ${opportunity.engineSource}
URGENCY: ${opportunity.urgencyTier}
SCORE: ${opportunity.score} / 100
CONFIDENCE: ${opportunity.confidence}
SANCTIONS FLAG: ${opportunity.isSanctionsAlert ? 'YES' : 'no'}

PROPOSED SUMMARY: ${opportunity.basis?.summary}
PROPOSED REASONING: ${opportunity.basis?.reasoning}
${peerSection}
CITED SIGNALS (the actual evidence — read these critically):
${signalDetail}

Now review:
1. Does the cited evidence (signals OR peer pattern, whichever is appropriate to the engine) actually support the legal need?
2. Is the entity actually the affected party, or is the signal about someone else?
3. Are routine filings being treated as litigation triggers (10-Q/8-K with no litigation markers)?
4. Is this a sanctions false-positive? (Major listed companies are not on the SDN list — substring matches are noise.)
5. Does the urgency tier match the evidence?

Pass cleanly OR flag with severity = minor / major / blocker.`;
  return callTool({
    apiKey, provider,
    // Use Sonnet for the critic — fast and decisive, doesn't need Opus's
    // depth since the heavy reasoning was already done by the composer.
    model: MODELS.sonnet,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    tool: TOOL,
    maxTokens: 600
  });
}
