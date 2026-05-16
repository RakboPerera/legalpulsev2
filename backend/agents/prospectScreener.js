// Prospect screener — LLM-driven service routing for an existing prospect
// entity. Replaces the regex `pickServiceFromSignal` which picks one
// service from the first signal's keywords; that single-shot routing was
// missing 80%+ of prospect opps because the wrong service got proposed and
// the composer self-flagged weak.
//
// Given a prospect and its entity-linked significant signals, this agent
// proposes up to 3 distinct service mandates the firm could pitch — each
// keyed to a specific subset of signals. Each candidate then runs through
// the existing composer + critic pipeline.
//
// Cost: one Haiku call per prospect with ≥1 signal. Cheap.

import { callTool, MODELS } from './client.js';

const SYSTEM_PROMPT = `You are a senior business-development partner at a top-tier law firm. You're reviewing market signals on a PROSPECT — a target company we don't yet act for. Your job: read their recent signals and identify 1-3 distinct legal service mandates the firm could credibly pitch them.

How a senior partner reads prospects:

1. The signal must be CONCRETE — a filed lawsuit, an announced deal, a regulatory action, a sanctions designation, a court ruling against them. Routine filings, analyst chatter, broad sector commentary do NOT support a prospect approach.

2. The legal service must MATCH the signal substance. Don't propose "M&A advisory" off a litigation signal. Don't propose "patent litigation" off an M&A signal. Each service candidate must cite the SPECIFIC signal indices (from the supplied list) that support it.

3. Distinct mandates only. If three signals all say "Stellantis class action filed", that's ONE service candidate (class_actions), not three. Only return multiple candidates when the signals genuinely point to multiple practice areas (e.g. an M&A announcement AND a separate enforcement action).

4. Be ruthless. Empty list is a valid answer when the signals don't support a confident pitch. We'd rather show 0 prospects on this entity than fabricate.

5. Service taxonomy — pick from these only:
force_majeure_advisory, cross_border_ma, merger_control, class_actions,
securities_litigation, patent_litigation, trade_secrets_litigation,
eu_competition, uk_competition, financial_services_regulation,
ai_regulation_advisory, ofac_advisory, eu_sanctions_advisory,
uk_ofsi_advisory, export_controls, esg_compliance, cybersecurity_advisory,
corporate_restructuring, fdi_clearance, public_takeovers,
leveraged_finance, acquisition_finance, decommissioning,
windfall_tax_advisory, product_liability, regulatory_defense,
commercial_litigation, tax_advisory, joint_ventures.

Output structured candidates via the screen_prospect tool.`;

const TOOL = {
  name: 'screen_prospect',
  description: 'Identify 0-3 legal service mandates a prospect entity has based on their recent signals.',
  input_schema: {
    type: 'object',
    properties: {
      candidates: {
        type: 'array',
        description: 'Up to 3 service candidates. Empty if no signal supports a confident pitch.',
        items: {
          type: 'object',
          properties: {
            service: { type: 'string', description: 'From the supplied taxonomy.' },
            signalIndices: {
              type: 'array',
              items: { type: 'integer' },
              description: 'Indices (0-based) of the signals from the input list that support this service.'
            },
            rationale: { type: 'string', description: '1 sentence: which signal triggers what legal need.' },
            confidence: { type: 'number', description: '0.0-1.0. Below 0.5, omit the candidate.' }
          },
          required: ['service', 'signalIndices', 'rationale', 'confidence']
        }
      }
    },
    required: ['candidates']
  }
};

function compactSignal(s, idx) {
  const desc = (s.description || '').slice(0, 350);
  const date = (s.publishedAt || '').slice(0, 10);
  return `[${idx}] (${s.source}, ${date}) "${(s.title || '').slice(0, 200)}"${desc ? ` — ${desc}` : ''}`;
}

export async function screenProspect({ prospect, signals, apiKey, provider }) {
  if (!signals.length) return { candidates: [] };
  const userPrompt = `PROSPECT: ${prospect.legalName} (${prospect.sector || 'unknown sector'}, ${prospect.hqJurisdiction || 'unknown HQ'})

SIGNALS (recent, entity-linked, classified as legally significant):
${signals.map(compactSignal).join('\n')}

Identify 0-3 service mandates we could credibly pitch this prospect, each tied to specific signal indices. Be ruthless — empty list is correct when signals don't support a real mandate.`;

  let out;
  try {
    out = await callTool({
      apiKey, provider,
      model: MODELS.haiku,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      tool: TOOL,
      maxTokens: 800
    });
  } catch (err) {
    return { candidates: [] };
  }
  const cleaned = (out.candidates || []).filter(c =>
    c && c.service && Array.isArray(c.signalIndices) && c.signalIndices.length
    && typeof c.confidence === 'number' && c.confidence >= 0.5
  );
  return { candidates: cleaned };
}
