// Cross-client event screener. Replaces the old per-signal entity-pre-tag
// flow with a senior-partner mental model: take a CLUSTER of corroborated
// signals on a single global event, then read the firm's client roster and
// ask "which of our clients are exposed to this, in what specific way, and
// what mandate does that create?" — exactly how a top BD partner reads the
// FT before a Monday meeting.
//
// Why a cluster-first approach: the old engine matched signals individually
// against entity names. When "Strait of Hormuz disruption" appears in three
// articles that don't all name BP/Exxon/Maersk by name, the old engine
// missed the cross-cutting impact. The composer prompt was already strong;
// the upstream routing was the bottleneck.
//
// Cost: one Sonnet call per event cluster. With ~30 clusters per bake,
// ~$0.10-0.20 in API spend.

import { callTool, MODELS } from './client.js';

const SYSTEM_PROMPT = `You are a senior business-development partner at a top-tier law firm. It is Monday morning. You are reading a single global event — a cluster of corroborated news / regulatory / market signals about the same underlying happening — and you have the firm's client roster in front of you.

Your job: identify which of OUR clients are exposed to this event, in what SPECIFIC way, and what concrete legal mandate the event creates for each. Then return a list of 0-5 client exposures.

How a senior partner reads market events:

1. NOT EVERY EVENT IS LEGAL WORK. 95% of news creates no mandate. Reject:
   - Industry-wide chatter that mentions our clients in passing without singling them out
   - Macroeconomic commentary, analyst hedging, "watching" notes
   - Routine corporate updates from third parties
   - Stories about competitors that don't directly affect our clients' obligations

2. WHEN AN EVENT CREATES A REAL MANDATE:
   - Geopolitical disruption affecting clients with operations / contracts in the affected region (force-majeure clauses, sanctions exposure, export-control compliance)
   - Regulatory action by an authority whose remit covers our client's sector (enforcement, rulemaking, fine, consent decree)
   - Court rulings that create precedent affecting our client's litigation posture
   - M&A activity in our client's competitive set that triggers merger-control review or counter-bid analysis
   - Sanctions designations of counterparties / suppliers our client transacts with
   - Industry-wide regulation (AI Act, ESG disclosure rules) that creates compliance work for clients in the affected sector

3. THE EXPOSURE MUST BE CONCRETE. Bad: "BP is in oil & gas, this is oil & gas news, must be relevant." Good: "BP's Hormuz transit through their tanker charter contracts likely activates force-majeure clauses given the reported diversion order; standing force-majeure advisory mandate creates a ~£200K-1M opportunity."

4. NAME THE LEGAL SERVICE. Pick from the firm's service taxonomy — the user prompt lists candidate services. Be precise: "force_majeure_advisory" not "litigation"; "merger_control" not "regulatory work".

5. URGENCY:
   - immediate: signal dated within 7 days, time-sensitive (court deadline, regulatory window, pitch race vs. rivals)
   - this_week: signal within 30 days, mandate concrete but no clock running
   - steady_state: signal older or mandate is structural

6. CONFIDENCE 0.0-1.0:
   - 0.8-1.0: client directly named in signals AND clear legal mechanism AND recent
   - 0.6-0.8: client clearly exposed (sector + jurisdiction + operations) but not directly named, OR named but mechanism less direct
   - 0.4-0.6: plausible exposure but would require partner to verify
   - <0.4: don't return — leave it out

7. NEVER:
   - Invent clients not in the supplied roster (use only the client IDs given)
   - Recommend services for sanctioned entities (sanctions are compliance escalations)
   - Use marketing language ("synergistic", "leverage", "comprehensive solution", "robust framework")
   - Return more than 5 exposures per event — pick the strongest
   - Pad the list with weak matches just to look thorough — empty list is a valid answer

Output structured exposures via the screen_event tool. If no client is genuinely exposed, return an empty exposures array.`;

const TOOL = {
  name: 'screen_event',
  description: 'Identify which of the firm\'s clients are exposed to a given global event and what legal service each requires.',
  input_schema: {
    type: 'object',
    properties: {
      eventInterpretation: {
        type: 'string',
        description: '1-2 sentences summarizing what the event actually is, in partner language. Used as the event headline downstream.'
      },
      exposures: {
        type: 'array',
        description: '0-5 client exposures. Empty if no client genuinely exposed.',
        items: {
          type: 'object',
          properties: {
            entityId: { type: 'string', description: 'Client ID from the supplied roster (e.g. c-bp). MUST exist in roster.' },
            service: { type: 'string', description: 'Service name from the supplied service taxonomy (e.g. force_majeure_advisory).' },
            rationale: { type: 'string', description: '1-2 sentences naming the specific exposure mechanism (clauses, jurisdictions, counterparties).' },
            urgency: { type: 'string', enum: ['immediate', 'this_week', 'steady_state'] },
            confidence: { type: 'number', description: '0.0-1.0. Below 0.4, omit.' }
          },
          required: ['entityId', 'service', 'rationale', 'urgency', 'confidence']
        }
      }
    },
    required: ['eventInterpretation', 'exposures']
  }
};

function compactRoster(clients, prospects, matters) {
  // Build a per-entity recent-services list so the LLM can see what
  // each client already engages us for (informs which services are
  // GAPS vs already-covered).
  const servicesByClient = {};
  for (const m of (matters || [])) {
    if (!m.client) continue;
    if (!servicesByClient[m.client]) servicesByClient[m.client] = new Set();
    for (const s of (m.services || [])) servicesByClient[m.client].add(s);
  }
  const entries = [...(clients || []), ...(prospects || [])].map(e => ({
    id: e.id,
    name: e.legalName,
    sector: e.sector,
    subSector: e.subSector,
    hq: e.hqJurisdiction,
    operates: e.countriesOfOperation,
    relationshipMaturity: e.relationshipMaturity || 'prospect',
    existingServices: Array.from(servicesByClient[e.id] || [])
  }));
  return entries;
}

function compactSignal(s) {
  const desc = (s.description || '').slice(0, 350);
  const date = (s.publishedAt || '').slice(0, 10);
  return `[${s.source}] "${(s.title || '').slice(0, 200)}" (${date})${date ? '' : ''}
  URL: ${s.sourceUrl || 'n/a'}
  Content: ${desc || '(title only)'}`;
}

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

export async function screenEventForClients({ event, signals, clients, prospects, matters, apiKey, provider }) {
  const roster = compactRoster(clients, prospects, matters);
  const signalSection = (signals || []).map(compactSignal).join('\n\n');

  const userPrompt = `EVENT CLUSTER (read this the way a partner reads the FT):

Topic: ${event.eventTopic || 'general event'}
Week: ${event.week || 'n/a'}
Jurisdictions cited: ${(event.jurisdictions || []).join(', ') || 'n/a'}
Industries cited: ${(event.industries || []).join(', ') || 'n/a'}
Source diversity: ${event.sourceCount || 1} distinct sources, ${event.signalCount || 1} signal(s) in cluster${event.signalCount >= 3 ? ' (multi-source corroborated)' : ''}.

SUPPORTING SIGNALS:
${signalSection}

CLIENT ROSTER (id, name, sector, HQ, operations, existing services with us):
${JSON.stringify(roster, null, 1).slice(0, 9000)}

CANDIDATE LEGAL SERVICES (pick from these — extend if essential):
${SERVICE_TAXONOMY_HINT.join(', ')}

Apply your senior-partner checklist:
1. What is the underlying event in plain partner English? (1-2 sentences)
2. Which of OUR clients are concretely exposed to this event? Reject sector-wide chatter; require a specific exposure mechanism for each name you flag.
3. For each exposed client, what is the precise legal mandate this creates? Pick the right service from the taxonomy.
4. Be HONEST about confidence. If only 1 client is genuinely exposed, return 1. If none are, return an empty exposures list.

Use the screen_event tool.`;

  const out = await callTool({
    apiKey, provider,
    model: MODELS.sonnet,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    tool: TOOL,
    maxTokens: 1500
  });

  // Validate exposures: every entityId must exist in the supplied roster.
  // The LLM occasionally hallucinates IDs — we drop those silently.
  const validIds = new Set(roster.map(r => r.id));
  const exposures = (out.exposures || []).filter(e => {
    if (!e.entityId || !validIds.has(e.entityId)) return false;
    if (typeof e.confidence !== 'number' || e.confidence < 0.4) return false;
    return true;
  });
  return {
    eventInterpretation: out.eventInterpretation || '',
    exposures
  };
}
