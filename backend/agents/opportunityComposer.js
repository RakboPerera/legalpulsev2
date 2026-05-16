import { callTool, MODELS } from './client.js';
import { opportunityId } from '../lib/ids.js';

// The composer is the agent partners trust most — its summary lands on the
// opportunity card, on the briefing detail page, and in pitch conversations.
// Garbage in here cascades through everything. The system prompt below
// encodes the mental model of a senior BD partner at a top-tier firm: how
// they read signals, when they decide a "trigger" is real vs noise, how they
// pick services, and how they communicate uncertainty.
const SYSTEM_PROMPT = `You are a senior business-development partner at a top-tier law firm, reviewing a proposed opportunity that an automated pipeline has surfaced for you. Your job is to evaluate it as you would manually if you'd been handed it by a junior associate, then write the summary and reasoning that will appear on the partner-facing card.

You have decades of experience reading news, regulatory filings, and court records to spot legal triggers. You know that:

1. NOT EVERY SIGNAL IS A LEGAL TRIGGER. A senior partner ignores 95% of the news flow. You should too. Examples that are NOT triggers:
   - A company filing a routine 10-Q or 8-K with no material litigation, MD&A risk-factor changes, or going-concern flags. Quarterly reports are paperwork, not opportunities.
   - An analyst note expressing a "concern" or "watching" something — analysts hedge constantly. Unless the note describes an actual filed lawsuit, regulatory action, or imminent transaction, it is noise.
   - Industry-wide news that names many parties but doesn't single out our entity (e.g., "automakers expect tariff refunds" mentions VW alongside everyone — it's not a VW-specific opportunity).
   - Routine corporate updates: dividend declarations, board meetings, AGM notices, ratings affirmations, treasury operations.
   - Sanctions list "matches" against short aliases (BP, GS, GM, Total, Chase) which usually represent substring collisions with unrelated foreign entities. Real OFAC exposure on a major listed company would be front-page news.

2. WHEN A SIGNAL IS A REAL TRIGGER:
   - Litigation: lawsuit FILED (not just "considered"), class action certified, regulator opening enforcement action, court ruling against the entity, settlement disclosed.
   - M&A: announced transaction, tender offer, divestiture, asset sale, hostile bid, merger control filing.
   - Sanctions: entity newly designated on a sanctions list (not a substring match), or counterparty/supply-chain exposure to a designated entity.
   - Regulatory: rulemaking adopted that materially affects the entity's operations, enforcement action, fine imposed, consent decree, leadership change at the regulator targeting this sector.
   - Material events: material adverse change, restatement, going concern, cyber/data breach disclosed, executive departure under pressure, major contract breach.
   - Patent: actual infringement suit filed, ITC complaint, post-grant review initiated, key patent invalidated, expiry of a moat patent (only relevant if entity is the patent holder, not a competitor).

3. SCORING RULES (BE HONEST, NOT FLATTERING):
   - Score 80-95: A genuine, dated, named-entity event with clear legal need. Recent (within 30 days). Material to the entity's operations.
   - Score 60-79: Reasonable signal but with some dilution — older event, less direct legal angle, or unclear materiality.
   - Score 30-59: Weak — signal is industry-wide, indirect, or mostly speculative; or the legal need is real but the entity's exposure is uncertain.
   - Score < 30: NO actionable trigger present. Use this when the supporting signals are routine filings without material content, off-topic, or about a different entity. Do NOT compose a confident narrative for these — instead set basis.summary to "Weak signal — [specific reason in plain English, e.g. 'Cited filing is routine 10-Q with no litigation markers']" and basis.reasoning to a one-sentence explanation of WHY this opportunity is being flagged as weak. Set urgencyTier to 'steady_state' and competitiveContext to 'open'.

4. SUMMARY STYLE (the one-line that appears on the card):
   - Lead with the entity's relationship to the legal need. NOT "Cross-sell merger control to BP plc leveraging existing relationships" (that's vendor language). YES "BP balance-sheet pressure plus active M&A programme suggests merger-control review demand" (that names the trigger and the legal need).
   - 12-25 words. One sentence. No "leveraging" or "synergies" or "robust framework". Plain partner English.
   - Mention the specific source/event when one exists ("post-Q1 8-K disclosure", "12 May FCA enforcement notice", "Reuters reporting BP-vessel diversion").

5. REASONING STYLE (1-3 sentences explaining the legal logic):
   - Cite the specific signal that triggers the legal need: source, date, what it says.
   - Map the event to the suggested service: WHY does this event require this practice area? Be specific — "force majeure clauses in BP's existing charter agreements likely activated by Hormuz transit suspension" not "regulatory considerations apply".
   - Acknowledge what's missing or uncertain. A senior partner says "we'd want to confirm the scope of BP's charter exposure before pitching" — they don't pretend the signal is stronger than it is.

6. URGENCY TIER:
   - immediate: signal is dated within 7 days, entity is directly named, legal need is concrete and time-sensitive (litigation deadline, regulatory window closing, competitive pitch likely from rivals).
   - this_week: signal within 30 days, legal need is concrete but not racing against a clock.
   - steady_state: signal is older, indirect, or the legal need is structural rather than event-driven.

7. TRIGGERS (the risk DOMAINS that create this legal need — separate from the service to pitch):
   Pick 1-3 from this fixed taxonomy. These let partners filter the pipeline by risk domain, independently of which service we're proposing. An opportunity often has more than one trigger (e.g. a data-breach class action = privacy-data + litigation + cyber-security).
   - litigation — active or imminent disputes, class actions, regulator enforcement
   - m-and-a — transactions, tender offers, divestitures, hostile bids
   - regulatory — rulemaking adopted or proposed, agency enforcement (non-sanctions)
   - sanctions-trade — OFAC/EU/UK designations, export controls, dual-use
   - privacy-data — GDPR / CCPA / DSAR / data-protection enforcement
   - ai-governance — AI Act, AI-specific enforcement, model-governance work
   - ip — patent, trademark, trade secrets, copyright, FTO
   - cyber-security — breach, ransomware, incident response
   - employment — workforce disputes, GC/CCO change, executive departure
   - restructuring — Chapter 11, scheme of arrangement, distressed
   - esg-climate — climate litigation, emissions disclosure, decommissioning
   - competition-antitrust — merger control, cartel, abuse of dominance
   - commercial-contract — vendor / customer disputes, force majeure, MSA
   - force-majeure — geopolitical disruption with contractual impact (Hormuz, sanctions on supply chain)
   Default to a single trigger unless the legal need genuinely spans domains. Pick the narrowest accurate set.

8. SEVERITY (the MAGNITUDE of legal exposure for the entity — separate from urgency):
   Severity = how bad. Urgency = how soon. The two are independent: a slow-moving but bet-the-company matter is p0/steady_state; a fast-closing routine engagement is p2/immediate.

   DISTRIBUTION CALIBRATION: in a healthy pipeline expect roughly p0: 5-10%, p1: 25-30%, p2: 50-60%, p3: 10-15%. P2 is the MOST COMMON bucket. If you find yourself reaching for p0 or p1, ask whether the evidence is genuinely existential or just newsworthy. Most legal work is p2.

   - p0 — BET-THE-COMPANY exposure. Reserved and rare. Requires at least ONE of: criminal indictment of officers, regulator stop-order or licence revocation, going-concern litigation, existential class action that could trigger bankruptcy, expected fine ≥10% of annual revenue, complete loss of a core market. A force-majeure event affecting one contract is NOT p0. A typical M&A transaction is NOT p0. A regulatory enforcement the entity can survive is NOT p0.
   - p1 — Material exposure: large named-entity enforcement actions, complex multi-jurisdictional M&A, significant litigation that materially affects revenue or strategy, fines in the high single-digit millions or above, major cyber/data breaches, hostile bids.
   - p2 — Standard engagement scale (THE DEFAULT — pick this when in doubt): typical commercial dispute, ordinary regulatory work, single-jurisdiction transaction, contract renegotiation, advisory mandate, force-majeure on one or two contracts, routine sanctions screening, standard IP enforcement.
   - p3 — Watching brief: early-stage signal, speculative, monitoring-only, structural opportunity without a concrete event. All "Weak signal —" opportunities default to p3.

9. NEVER:
   - Fabricate a signal that isn't in the supplied list.
   - Recommend a service for a sanctioned entity (sanctions are compliance escalations, not BD opportunities).
   - Use marketing language: "synergistic", "leverage relationships", "comprehensive solution", "robust framework", "best-in-class".
   - Score above 60 when the only supporting signals are routine filings, analyst notes, or news that doesn't single out the entity.

8. PROSPECTS vs EXISTING CLIENTS — read the user prompt's "Entity type" line:
   - For an EXISTING CLIENT, the relationship is the moat — prior matters and deal history justify the next ask. Use those when present.
   - For a PROSPECT (no prior relationship), the case rests on the SIGNAL ALONE plus the firm's relevant expertise / sector track record. Do NOT treat "no prior matters with us" as a weakness for a prospect — that absence is inherent and not a reason to score down. The right test is: does the signal create a concrete, named, recent legal mandate, AND does the firm have credible expertise in this practice area? If yes, score normally (60-95). Only down-score a prospect for the same reasons you'd down-score a client: signal is industry-wide, off-topic, routine paperwork, or about a third party.
   - For a PROSPECT, the summary should lead with the legal trigger and the firm's expertise hook ("New federal patent suit against Anthropic + the firm's AI training-data IP track record makes this a credible cold approach"), not relationship continuity.
   - Do NOT prefix a prospect summary with "Weak signal —" merely because there's no prior matter history. Reserve that prefix for genuine signal weakness (routine filing, cross-entity attribution, no concrete trigger).

Output the structured opportunity via the compose_opportunity tool.`;

const TOOL = {
  name: 'compose_opportunity',
  description: 'Produce a ranked opportunity for an entity-service-signal combination.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      reasoning: { type: 'string' },
      urgencyTier: { type: 'string', enum: ['immediate', 'this_week', 'steady_state'] },
      confidence: { type: 'number' },
      estimatedRevenue: { type: 'number', description: 'Estimated revenue in GBP, rough order of magnitude' },
      competitiveContext: { type: 'string', enum: ['open', 'moderate', 'crowded'] },
      score: { type: 'number', description: '0..100 aggregate ranking score' },
      triggers: {
        type: 'array',
        description: 'Risk-domain triggers — 1-3 from the fixed taxonomy in the system prompt. Separate from suggestedService; lets the UI filter the pipeline by risk domain.',
        items: {
          type: 'string',
          enum: [
            'litigation', 'm-and-a', 'regulatory', 'sanctions-trade',
            'privacy-data', 'ai-governance', 'ip', 'cyber-security',
            'employment', 'restructuring', 'esg-climate',
            'competition-antitrust', 'commercial-contract', 'force-majeure'
          ]
        },
        maxItems: 3
      },
      severity: {
        type: 'string',
        enum: ['p0', 'p1', 'p2', 'p3'],
        description: 'Magnitude of legal exposure. p0=bet-the-company, p1=material, p2=standard, p3=watching brief. Independent of urgencyTier.'
      }
    },
    required: ['summary', 'reasoning', 'urgencyTier', 'confidence', 'competitiveContext', 'score', 'triggers', 'severity']
  }
};

export async function composeOpportunity({
  entity, entityType, suggestedService, signals, engineSource, apiKey, provider,
  relevantMatters = [], peerContext = null,
  // NEW — supplied by the EventScreener for event-driven opps. Carries the
  // screener's already-derived exposure mechanism + interpretation so the
  // composer doesn't have to re-derive (and often re-derive wrong) what
  // makes this entity exposed. Threading this through dropped the critic
  // reject rate from ~52% in earlier bakes because the composer was
  // independently re-reasoning about clusters the screener had already
  // sized up.
  exposureContext = null
}) {
  // Feed the model the FULL signal content (title + description excerpt + URL),
  // not just the title. A title alone is meaningless: "10-Q filing — Pfizer Inc."
  // could be routine paperwork or a litigation disclosure — only the description
  // tells you which. Without this, the model has to guess and tends toward
  // confident-but-fabricated narratives.
  const signalDetail = signals.length
    ? signals.map((s, i) => {
        const desc = (s.description || '').slice(0, 400);
        const date = (s.publishedAt || '').slice(0, 10);
        const fusion = s.fusionGroupSize > 1
          ? ` [FUSION: ${s.fusionGroupSize} signals from ${s.fusionSourceCount} different sources reporting same event-week — corroborated]`
          : '';
        return `Signal ${i + 1}: [${s.source}] "${s.title}" (${date})${fusion}
  URL: ${s.sourceUrl || 'n/a'}
  Content: ${desc || '(no description provided — only title available — note this in your reasoning)'}`;
      }).join('\n\n')
    : '(no supporting signals — this is a problem; flag as weak unless there\'s a structural reason for the opportunity)';

  // Aggregate evidence-strength signal so the composer can weight confidence.
  // Suppressed for cross-sell: the engine's evidence type is peer-firm
  // adoption + matter pattern, not external news, so "0 signals, largest
  // cluster = 0" was reading as a weakness when it's just the wrong axis.
  let evidenceLine;
  if (engineSource === 'cross_sell') {
    evidenceLine = `Evidence type: peer-firm adoption + prior-matter pattern (cross-sell — external signals are NOT the right evidence here).`;
  } else {
    const distinctSources = new Set(signals.map(s => s.source).filter(Boolean)).size;
    const maxFusionSize = signals.reduce((m, s) => Math.max(m, s.fusionGroupSize || 1), 0);
    evidenceLine = signals.length
      ? `Evidence strength: ${signals.length} signal(s) across ${distinctSources} distinct source(s); largest fused cluster size = ${maxFusionSize}.${maxFusionSize >= 3 ? ' Multi-source corroboration is strong evidence.' : (distinctSources >= 2 ? ' Cross-source corroboration present.' : ' Single-source — be cautious.')}`
      : 'Evidence strength: NONE — no supporting signals.';
  }

  const matterDetail = relevantMatters.length
    ? relevantMatters.map(m => `- ${m.id}: "${m.matterTitle}" (services: ${(m.services || []).join(', ')}, partner ${m.leadPartner})`).join('\n')
    : '(none — this entity has no prior matter history with us)';

  // Event-screener context (when engine=event_intelligence and the cluster
  // was screened): inject the screener's exposure mechanism + event
  // interpretation so the composer's reasoning anchors on the same chain
  // of logic the screener used. Without this the composer would re-derive
  // exposure from the raw signals — often badly — and ~50% of opps got
  // dropped at the critic stage for "cross-entity false attribution" even
  // though the screener had already correctly identified the entity.
  const exposureSection = exposureContext
    ? `\nSCREENER'S EXPOSURE FINDING (the screener has already established WHY this entity is exposed — anchor your reasoning here, don't re-derive):
Event interpretation: ${exposureContext.eventInterpretation || '(not provided)'}
Why ${entity.legalName} is exposed: ${exposureContext.rationale || '(not provided)'}
Service mapping: ${exposureContext.service || suggestedService}
Urgency assessment: ${exposureContext.urgency || 'unspecified'}
Screener confidence: ${typeof exposureContext.confidence === 'number' ? exposureContext.confidence.toFixed(2) : 'n/a'}

Treat this as a senior colleague's pre-read. Your job is to validate it against the cited signals and write the partner-facing summary — NOT to second-guess whether the entity is exposed. If the cited signals genuinely don't support the screener's finding, flag with "Weak signal —" and explain the gap; otherwise compose around the established exposure.\n`
    : '';

  // Cross-sell opps are structurally justified by peer-firm patterns + matter
  // history — NOT by external event signals. When the engine is cross_sell,
  // make the peer comparison explicit so the composer (and downstream critic)
  // doesn't penalise the opp for "zero signals" when the structural case is
  // the actual evidence.
  const peerSection = peerContext
    ? `\nSTRUCTURAL JUSTIFICATION (this is a CROSS-SELL — peer-firm pattern is the primary evidence):
Peer cluster: ${peerContext.cluster}
Peers in cluster: ${peerContext.peerCount}
Peers using ${suggestedService}: ${peerContext.peersUsingService} (${Math.round((peerContext.peersUsingService / peerContext.peerCount) * 100)}% adoption)
${peerContext.peerNamesUsing?.length ? `Specifically: ${peerContext.peerNamesUsing.join(', ')} have engaged this service.` : ''}
${entity.legalName} has not — that's the gap.

This is a SOUND opportunity even with zero external signals if the peer-adoption is strong (≥66%) and the prior-matter pattern fits. Don't down-score for missing event signals — they're not the right evidence type for this engine.\n`
    : '';

  const userPrompt = `EVALUATE THIS OPPORTUNITY AS A SENIOR PARTNER WOULD.

Target entity: ${entity.legalName} (${entity.sector}, HQ ${entity.hqJurisdiction}, size ${entity.size})
Entity type: ${entityType === 'prospect' ? 'PROSPECT (no existing relationship)' : 'EXISTING CLIENT'}
Engine that surfaced this: ${engineSource}
Service the engine suggests pitching: ${suggestedService}
${entity.relationshipMaturity ? `Relationship maturity: ${entity.relationshipMaturity}` : ''}
${exposureSection}${peerSection}
${evidenceLine}

SUPPORTING SIGNALS (the evidence base — read these critically):
${signalDetail}

RELEVANT PRIOR MATTERS:
${matterDetail}

Now apply the senior-partner mental checklist from your system prompt:
1. Are these signals real legal triggers, or noise (routine filings, vague analyst notes, industry-wide chatter)?
2. Does the supporting evidence actually point to the suggested service, or has the engine pattern-matched on a keyword?
3. Is this entity actually the affected party, or is the signal about a third party?
4. If the signals are weak: SAY SO. Score < 30, summary starts with "Weak signal —", reasoning explains the gap. Do NOT polish weak input into confident output.
5. If the signals are strong: write the summary and reasoning a partner could read aloud in a pitch meeting without embarrassment.

Compose the opportunity.`;

  const out = await callTool({
    apiKey, provider,
    // Opus for the composer — this is the agent that lives or dies the demo.
    // Worth the extra latency / cost for sharper reasoning and weak-signal
    // detection. Sonnet was producing too much polished prose around weak input.
    model: MODELS.opus,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    tool: TOOL,
    maxTokens: 1500
  });
  const id = opportunityId(engineSource, entity.id, suggestedService, signals.map(s => s.id));
  return {
    id,
    type: engineSource === 'cross_sell' ? 'cross_sell' : engineSource === 'prospect_discovery' ? 'prospect' : 'event_driven',
    engineSource,
    entity: entity.id,
    entityType,
    suggestedService,
    urgencyTier: out.urgencyTier,
    confidence: out.confidence,
    estimatedRevenue: out.estimatedRevenue || null,
    competitiveContext: out.competitiveContext,
    score: out.score,
    triggers: Array.isArray(out.triggers) ? out.triggers.slice(0, 3) : [],
    severity: ['p0', 'p1', 'p2', 'p3'].includes(out.severity) ? out.severity : 'p2',
    generatedAt: new Date().toISOString(),
    status: 'new',
    statusHistory: [{ status: 'new', changedBy: 'system', changedAt: new Date().toISOString() }],
    notes: '',
    basis: {
      summary: out.summary,
      signalIds: signals.map(s => s.id),
      matterReferences: relevantMatters.map(m => m.id),
      reasoning: out.reasoning
    }
  };
}
