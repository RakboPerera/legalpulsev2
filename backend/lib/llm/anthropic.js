// Anthropic adapter. Implements the shared LLMClient interface (callTool /
// callText / runToolUseLoop / modelForTier). Used both for runtime BYOK
// (req.user.providerApiKey) and the bake script (ANTHROPIC_API_KEY env).
import Anthropic from '@anthropic-ai/sdk';
import { recordUsage } from './usage.js';

// Tier-to-model map. Operator can pin specific model IDs via env if a model
// is renamed or they want to force a specific point release.
function tierModels() {
  return {
    reasoning: process.env.ANTHROPIC_REASONING_MODEL || 'claude-opus-4-7',
    balanced:  process.env.ANTHROPIC_BALANCED_MODEL  || 'claude-sonnet-4-6',
    fast:      process.env.ANTHROPIC_FAST_MODEL      || 'claude-haiku-4-5'
  };
}

// Anthropic deprecated the `temperature` field on Opus 4.x (and likely all
// future Opus tiers). Sending it returns 400 "temperature is deprecated for
// this model". Match by family name — covers any versioned variant like
// claude-opus-4-7-20260315. If Anthropic widens the deprecation to Sonnet/
// Haiku, just extend the check.
function modelRejectsTemperature(modelId) {
  if (typeof modelId !== 'string') return false;
  return /claude-opus-4/i.test(modelId);
}

export class AnthropicAdapter {
  constructor(apiKey) {
    if (!apiKey) throw new Error('Anthropic API key required');
    this.providerName = 'anthropic';
    this.client = new Anthropic({ apiKey });
    this._tiers = tierModels();
  }

  modelForTier(tier) {
    return this._tiers[tier] || this._tiers.balanced;
  }

  async callTool({ system, messages, tool, model, maxTokens = 1500, maxRetries = 2, temperature }) {
    const m = model || this._tiers.balanced;
    let attempt = 0;
    while (true) {
      try {
        // Anthropic's Opus 4.x rejects the `temperature` field as deprecated
        // (returns 400 "temperature is deprecated for this model"). Sonnet
        // and Haiku still accept it. Only include the field when the caller
        // explicitly passed a value AND the model isn't a known reject-er.
        const body = {
          model: m,
          max_tokens: maxTokens,
          system,
          tools: [tool],
          tool_choice: { type: 'tool', name: tool.name },
          messages
        };
        if (typeof temperature === 'number' && !modelRejectsTemperature(m)) {
          body.temperature = temperature;
        }
        const response = await this.client.messages.create(body);
        const block = response.content.find(b => b.type === 'tool_use' && b.name === tool.name);
        if (!block) throw new Error('No tool_use block in response');
        recordUsage('anthropic', m, response.usage?.input_tokens, response.usage?.output_tokens);
        return block.input;
      } catch (err) {
        attempt++;
        if (attempt > maxRetries) throw err;
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }

  async callText({ system, messages, model, maxTokens = 2000, maxRetries = 2, temperature }) {
    const m = model || this._tiers.reasoning;
    let attempt = 0;
    while (true) {
      try {
        const body = { model: m, max_tokens: maxTokens, system, messages };
        if (typeof temperature === 'number' && !modelRejectsTemperature(m)) {
          body.temperature = temperature;
        }
        const response = await this.client.messages.create(body);
        recordUsage('anthropic', m, response.usage?.input_tokens, response.usage?.output_tokens);
        const text = response.content
          .filter(b => b.type === 'text').map(b => b.text).join('\n');
        return { text, raw: response };
      } catch (err) {
        attempt++;
        if (attempt > maxRetries) throw err;
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }

  // Multi-turn tool use loop. The agent can request up to `maxRounds` tool
  // calls; after the budget is exhausted we make one final call with no tools
  // to force a text answer (otherwise the conversation ends mid-tool-use
  // and callers see an empty response — the bug we just fixed in
  // eventChatAgent before extracting this into the adapter).
  async runToolUseLoop({ system, messages, tools, executeTool, maxRounds = 3, model, maxTokens = 1500, temperature }) {
    const m = model || this._tiers.balanced;
    const conversation = [...messages];
    const toolsUsed = [];
    const includeTemp = typeof temperature === 'number' && !modelRejectsTemperature(m);
    for (let round = 0; round < maxRounds; round++) {
      const body = {
        model: m, max_tokens: maxTokens, system, tools, messages: conversation
      };
      if (includeTemp) body.temperature = temperature;
      const response = await this.client.messages.create(body);
      recordUsage('anthropic', m, response.usage?.input_tokens, response.usage?.output_tokens);
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || !toolUseBlocks.length) {
        const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        return { text, toolsUsed };
      }
      conversation.push({ role: 'assistant', content: response.content });
      const toolResultBlocks = [];
      for (const block of toolUseBlocks) {
        toolsUsed.push({ tool: block.name, input: block.input });
        let result;
        try {
          result = await executeTool(block.name, block.input);
        } catch (err) {
          result = { error: err.message?.slice(0, 200) || 'tool execution failed' };
        }
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result).slice(0, 8000)
        });
      }
      conversation.push({ role: 'user', content: toolResultBlocks });
    }
    // Tool budget exhausted — final answer with no tools.
    try {
      const finalBody = {
        model: m, max_tokens: maxTokens,
        system: system + '\n\nTool budget for this turn is exhausted. Give your final answer in plain text, no more tool calls.',
        messages: conversation
      };
      if (includeTemp) finalBody.temperature = temperature;
      const finalResponse = await this.client.messages.create(finalBody);
      recordUsage('anthropic', m, finalResponse.usage?.input_tokens, finalResponse.usage?.output_tokens);
      const text = finalResponse.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      return { text: text || '(no response after tool budget)', toolsUsed };
    } catch (err) {
      console.warn('[anthropic] final-answer call failed:', err.message);
      return { text: '(failed to produce final answer after tool budget)', toolsUsed };
    }
  }
}
