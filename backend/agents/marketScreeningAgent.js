// Market-screening agent: invoked from the Outreach > Market Screening UI
// when a partner clicks a single event cluster and asks "given this event,
// what business-development opportunities exist?". Unlike the EventScreener
// (bake-time, restricted to existing clients), this agent is encouraged to
// surface NEW companies mentioned in the signals that the firm might want
// to pursue as fresh prospects.
//
// Output drives two side-effects in the route handler:
//   1. Any returned NEW prospect entity is appended to workspace.prospects
//      with discoverySource: 'market_screening'.
//   2. Each opportunity is persisted to workspace.opportunities with
//      engineSource: 'market_screening' and a deterministic ID — so the
//      existing per-opp chat route works unchanged.

import { callTool, MODELS } from './client.js';

const SYSTEM_PROMPT = `You are a senior business-development partner at a top-tier law firm. A junior associate has flagged a single global event for your review and asked: "What business-development opportunities does this create for us?"

Your job: read the cluster of corroborated signals, then identify 1-5 concrete opportunities. For each, decide whether the most-impacted entity is:
  (a) one of OUR EXISTING clients/prospects (use their ID from the supplied roster), OR
  (b) a NEW COMPANY mentioned in the signals that we should pursue (you propose a prospect record we'll add to our roster).

How to read the event:

1. Reject the obvious noise. 95% of news creates no mandate. Ignore industry-wide chatter, analyst hedging, routine corporate updates.

2. Identify ENTITIES at the centre of the event. These are the companies whose obligations, exposure, or strategic position has materially changed because of what the signals describe. Be sceptical of names that just appear in passing.

3. For each central entity, name the LEGAL MANDATE the event creates. Be precise. "Force-majeure clauses in Maersk's charter agreements likely activated by Hormuz transit suspension" — not "Maersk needs maritime advice."

4. Pick a SERVICE from the firm's taxonomy (listed in the user prompt).

5. CONFIDENCE 0.0-1.0:
   - 0.8-1.0: entity directly named in signals + clear legal mechanism + recent
   - 0.6-0.8: entity clearly central to event but mechanism less direct
   - 0.4-0.6: plausible but would need partner to verify
   - <0.4: don't return — leave it out

6. NEW PROSPECT entities — return one when:
   - The signals name a specific company at the centre of the event
   - That company is not in our supplied roster
   - The company would plausibly retain a top-tier law firm (large public, sector-aligned with our practice areas, jurisdictionally accessible)
   - Provide: legalName, sector, hqJurisdiction (best-guess from signal content), knownAliases (any short forms used in signals), sourceMentionedAs (how it was named), discoveryRationale

7. NEVER:
   - Invent entities not mentioned in the signals
   - Recommend services for sanctioned entities (sanctions = compliance escalation, not BD)
   - Use marketing language ("synergistic", "leverage", "comprehensive solution")
   - Pad the list to look thorough — quality over quantity

Output via the generate_screening_opportunities tool. Empty array is a valid answer if no concrete mandate exists.`;

const TOOL = {
  name: 'generate_screening_opportunities',
  description: 'Identify business-development opportunities from a global event cluster. May reference existing clients/prospects OR propose new prospects.',
  input_schema: {
    type: 'object',
    properties: {
      eventInterpretation: {
        type: 'string',
        description: '1-2 sentences in partner English describing what this event actually is.'
      },
      opportunities: {
        type: 'array',
        description: '0-5 opportunities. Empty if event creates no concrete mandate.',
        items: {
          type: 'object',
          properties: {
            entityRef: {
              type: 'object',
              description: 'Either { existingId: "c-xxx" or "pr-xxx" } for a roster entity, or { newProspect: {...} } for a discovered new entity.',
              properties: {
                existingId: { type: 'string', description: 'ID from supplied roster. Mutually exclusive with newProspect.' },
                newProspect: {
                  type: 'object',
                  properties: {
                    legalName: { type: 'string' },
                    sector: { type: 'string', description: 'Best-guess from signal content (oil_gas, pharma, banking, etc.)' },
                    hqJurisdiction: { type: 'string', description: 'USA / UK / EU / Other.' },
                    knownAliases: { type: 'array', items: { type: 'string' }, description: 'Short forms / tickers referenced.' },
                    sourceMentionedAs: { type: 'string', description: 'How the entity appears in the signals.' },
                    discoveryRationale: { type: 'string', description: 'Why this entity is at the centre of the event.' }
                  },
                  required: ['legalName', 'sector', 'hqJurisdiction']
                }
              }
            },
            service: { type: 'string', description: 'Service from the supplied taxonomy.' },
            urgency: { type: 'string', enum: ['immediate', 'this_week', 'steady_state'] },
            confidence: { type: 'number' },
            score: { type: 'number', description: '0-100 ranking score.' },
            summary: { type: 'string', description: '12-25 words. One sentence. The partner-card headline.' },
            reasoning: { type: 'string', description: '1-3 sentences. Cite specific signals + legal mechanism + service mapping.' }
          },
          required: ['entityRef', 'service', 'urgency', 'confidence', 'score', 'summary', 'reasoning']
        }
      }
    },
    required: ['eventInterpretation', 'opportunities']
  }
};

const SERVICE_TAXONOMY_HINT = [
  'force_majeure_advisory', 'cross_border_ma', 'merger_control', 'class_actions',
  'securities_litigation', 'patent_litigation', 'trade_secrets_litigation',
  'eu_competition', 'uk_competition', 'financial_services_regulation',
  'ai_regulation_advisory', 'ofac_advisory', 'eu_sanctions_advisory',
  'uk_ofsi_advisory', 'export_controls', 'esg_compliance', 'cybersecurity_advisory',
  'corporate_restructuring', 'fdi_clearance', 'public_takeovers',
  'leveraged_finance', 'acquisition_finance', 'decommissioning',
  'windfall_tax_advisory', 'product_liability', 'regulatory_defense',
  'commercial_litigation', 'tax_advisory', 'joint_ventures'
];

function compactRoster(clients, prospects) {
  return [...(clients || []), ...(prospects || [])].map(e => ({
    id: e.id,
    name: e.legalName,
    sector: e.sector,
    hq: e.hqJurisdiction,
    type: e.id.startsWith('pr-') ? 'prospect' : 'client'
  }));
}

function compactSignal(s) {
  const desc = (s.description || '').slice(0, 350);
  const date = (s.publishedAt || '').slice(0, 10);
  return `[${s.source}] "${(s.title || '').slice(0, 200)}" (${date})
  URL: ${s.sourceUrl || 'n/a'}
  Content: ${desc || '(title only)'}`;
}

export async function generateOppsFromEvent({ event, signals, workspace, apiKey, provider }) {
  const roster = compactRoster(workspace.clients, workspace.prospects);
  const signalSection = (signals || []).slice(0, 8).map(compactSignal).join('\n\n');

  const userPrompt = `EVENT CLUSTER:

Topic: ${event.eventTopic || 'general event'}
Week: ${event.week || 'n/a'}
Headline: ${event.headline || 'n/a'}
Jurisdictions: ${(event.jurisdictions || []).join(', ') || 'n/a'}
Industries: ${(event.industries || []).join(', ') || 'n/a'}
Source diversity: ${event.sourceCount || 1} distinct sources, ${event.signalCount || 1} signal(s)${event.signalCount >= 3 ? ' — multi-source corroborated' : ''}.

SUPPORTING SIGNALS:
${signalSection}

OUR ROSTER (existing clients + prospects, by id):
${JSON.stringify(roster, null, 1).slice(0, 6000)}

CANDIDATE SERVICES:
${SERVICE_TAXONOMY_HINT.join(', ')}

Apply the senior-partner checklist:
1. What is the underlying event in plain partner English?
2. Who is at the centre of this event — existing client/prospect, or new company we should pursue?
3. For each central entity, what specific legal mandate does the event create? (Force-majeure clause activation? Merger-control filing? Disclosure obligation? Litigation defence?)
4. Pick the service. Be honest about confidence.
5. If no concrete mandate exists, return an empty opportunities array.

Generate via generate_screening_opportunities.`;

  const out = await callTool({
    apiKey, provider,
    model: MODELS.sonnet,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    tool: TOOL,
    maxTokens: 2000
  });

  const validEntityIds = new Set(roster.map(r => r.id));
  const cleaned = (out.opportunities || []).filter(o => {
    if (typeof o.confidence !== 'number' || o.confidence < 0.4) return false;
    const ref = o.entityRef || {};
    if (ref.existingId) {
      if (!validEntityIds.has(ref.existingId)) return false;
    } else if (ref.newProspect) {
      if (!ref.newProspect.legalName) return false;
    } else {
      return false;
    }
    return true;
  });

  return {
    eventInterpretation: out.eventInterpretation || '',
    opportunities: cleaned
  };
}
