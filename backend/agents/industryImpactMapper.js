import { callTool, MODELS } from './client.js';

const SYSTEM_PROMPT = `You are the Industry Impact Mapper agent. Given an event signal, identify the industries it affects, with confidence. Use standard industry classifications (oil_gas, banking, shipping, automotive, semiconductors, defense_aerospace, pharma, telecoms, technology, commodities, fintech, real_estate, energy_transition, etc.). Be conservative — only include industries clearly affected.`;

const TOOL = {
  name: 'map_industry_impact',
  description: 'Identify industries impacted by an event.',
  input_schema: {
    type: 'object',
    properties: {
      affectedIndustries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            industry: { type: 'string' },
            confidence: { type: 'number' },
            rationale: { type: 'string' }
          },
          required: ['industry', 'confidence', 'rationale']
        }
      },
      eventSummary: { type: 'string' }
    },
    required: ['affectedIndustries', 'eventSummary']
  }
};

export async function mapIndustryImpact(signal, { apiKey, provider } = {}) {
  const userPrompt = `Event signal:
Title: ${signal.title}
Description: ${signal.description ?? ''}
Source: ${signal.source}
Jurisdictions: ${(signal.jurisdictions || []).join(', ')}

Identify the affected industries.`;
  return callTool({
    apiKey, provider,
    model: MODELS.sonnet,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    tool: TOOL,
    maxTokens: 800
  });
}
