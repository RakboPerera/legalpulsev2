import { callTool, MODELS } from './client.js';

const SYSTEM_PROMPT = `You are the Legal Needs Mapper agent. Given an event signal and the industries it affects, identify the specific legal needs that arise — the specific practice-area services that affected entities are likely to require.

Be specific. Generic answers like "litigation may be needed" are not useful. Instead identify specific work:
- For a force majeure event affecting shipping: force majeure clause review, charter renegotiation, alternative-route contract drafting, war-risk insurance disputes
- For a sanctions designation: OFAC compliance review, asset freeze analysis, exemption applications, contract performance analysis
- For an M&A announcement: regulatory clearance, antitrust review, acquisition financing, employment/integration advice

For each legal need return service ID (use the firm's taxonomy: ma_advisory, cross_border_ma, force_majeure_advisory, ofac_advisory, eu_sanctions_advisory, uk_ofsi_advisory, export_controls, securities_litigation, patent_litigation, product_liability, class_actions, international_arbitration, regulatory_defense, financial_services_regulation, eu_competition, merger_control, ai_regulation_advisory, energy_transition, windfall_tax_advisory, decommissioning, cybersecurity_advisory, restructuring_insolvency, etc.).`;

const TOOL = {
  name: 'map_legal_needs',
  description: 'Identify specific legal needs arising from an event.',
  input_schema: {
    type: 'object',
    properties: {
      legalNeeds: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            service: { type: 'string' },
            rationale: { type: 'string' },
            confidence: { type: 'number' },
            urgencyTier: { type: 'string', enum: ['immediate', 'this_week', 'steady_state'] }
          },
          required: ['service', 'rationale', 'confidence']
        }
      }
    },
    required: ['legalNeeds']
  }
};

export async function mapLegalNeeds(signal, industries, { apiKey, provider } = {}) {
  const userPrompt = `Event:
Title: ${signal.title}
Description: ${signal.description ?? ''}
Affected industries: ${industries.map(i => i.industry).join(', ')}

What specific legal work arises? Be concrete and cite practice areas.`;
  return callTool({
    apiKey, provider,
    model: MODELS.sonnet,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    tool: TOOL,
    maxTokens: 1000
  });
}
