import { callTool, MODELS } from './client.js';

const SYSTEM_PROMPT = `You are the Cross-Sell Pattern Analyzer. Given a client's service usage compared to peers in their industry cluster, identify the most actionable service gap. Prioritise: (a) gaps where most peers use the service (high penetration), (b) gaps that align with current external signals about the client, (c) services the suggested partner has demonstrated expertise in.

Reasoning should be tight (1-3 sentences) and cite the specific gap penetration percentage.`;

const TOOL = {
  name: 'analyze_cross_sell',
  description: 'Pick the best cross-sell service gap and rationale.',
  input_schema: {
    type: 'object',
    properties: {
      pickedService: { type: 'string' },
      rationale: { type: 'string' },
      partnerFit: { type: 'string' },
      confidence: { type: 'number' },
      urgencyTier: { type: 'string', enum: ['immediate', 'this_week', 'steady_state'] }
    },
    required: ['pickedService', 'rationale', 'confidence']
  }
};

export async function analyzeCrossSellGap({ client, gaps, partners, recentSignals, apiKey, provider }) {
  const userPrompt = `Client: ${client.legalName} (${client.sector}, ${client.size}, ${client.hqJurisdiction})

Service gaps (services peers use that this client does not):
${gaps.slice(0, 8).map(g => `- ${g.service} | penetration ${(g.penetration * 100).toFixed(0)}% (${g.peersUsingService}/${g.peerCount} peers)`).join('\n')}

Recent external signals on this client (may inform which gap is timely):
${(recentSignals || []).slice(0, 5).map(s => `- [${s.source}] ${s.title}`).join('\n') || '(none)'}

Available partners:
${partners.map(p => `- ${p.id} | ${p.name} | ${p.practiceAreas.join(', ')} | tags: ${(p.expertiseTags || []).join(', ')}`).join('\n')}

Pick the most actionable gap.`;
  return callTool({
    apiKey, provider,
    model: MODELS.sonnet,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    tool: TOOL,
    maxTokens: 600
  });
}
