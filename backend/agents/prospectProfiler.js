import { callTool, MODELS } from './client.js';

const SYSTEM_PROMPT = `You are the Prospect Profiler. Given a prospect entity and the external signals observed about it, produce a structured profile and pick the firm-service that is the best fit. Prefer signals that indicate active legal need (litigation filed, regulatory action, M&A, sanctions exposure).`;

const TOOL = {
  name: 'profile_prospect',
  description: 'Profile a prospect and pick the most timely firm service.',
  input_schema: {
    type: 'object',
    properties: {
      pickedService: { type: 'string' },
      rationale: { type: 'string' },
      keyExposureSummary: { type: 'string' },
      urgencyTier: { type: 'string', enum: ['immediate', 'this_week', 'steady_state'] },
      confidence: { type: 'number' }
    },
    required: ['pickedService', 'rationale', 'keyExposureSummary', 'confidence']
  }
};

export async function profileProspect({ prospect, signals, firmPracticeAreas, apiKey, provider }) {
  const userPrompt = `Prospect: ${prospect.legalName} (${prospect.sector}, ${prospect.hqJurisdiction}, size ${prospect.size})

Recent signals:
${signals.slice(0, 8).map(s => `- [${s.source}] ${s.title} (${s.publishedAt})`).join('\n') || '(no external signals observed)'}

Firm's practice areas: ${firmPracticeAreas.map(p => p.name).join(', ')}

Pick the best-fit firm service and brief rationale.`;
  return callTool({
    apiKey, provider,
    model: MODELS.sonnet,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    tool: TOOL,
    maxTokens: 600
  });
}
