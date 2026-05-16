// OpenAI adapter — also serves DeepSeek (OpenAI-compatible API, different
// baseURL). Implements the same LLMClient interface as anthropic.js.
//
// Translation layer: every agent in this codebase shapes tools + messages
// in Anthropic format (content-block arrays, tool_use / tool_result blocks).
// This adapter converts those to OpenAI's flat message format on the way in
// and back on the way out, so agent code stays provider-agnostic.

import OpenAI from 'openai';
import { recordUsage } from './usage.js';

function openaiTierModels() {
  return {
    reasoning: process.env.OPENAI_REASONING_MODEL || 'gpt-4.1',
    balanced:  process.env.OPENAI_BALANCED_MODEL  || 'gpt-4o',
    fast:      process.env.OPENAI_FAST_MODEL      || 'gpt-4o-mini'
  };
}
function deepseekTierModels() {
  return {
    reasoning: process.env.DEEPSEEK_REASONING_MODEL || 'deepseek-reasoner',
    balanced:  process.env.DEEPSEEK_BALANCED_MODEL  || 'deepseek-chat',
    fast:      process.env.DEEPSEEK_FAST_MODEL      || 'deepseek-chat'
  };
}

// Anthropic tool: { name, description, input_schema: {type, properties, required} }
// OpenAI tool:   { type: 'function', function: { name, description, parameters: {type, properties, required} } }
function anthropicToolToOpenAI(tool) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema
    }
  };
}

// Translate Anthropic-style messages to OpenAI Chat Completions format.
// Inputs:
//   system  — optional string; becomes the first {role:'system'} message
//   messages — array of { role, content } where content can be:
//     - string (plain text)
//     - array of typed blocks: { type: 'text' | 'tool_use' | 'tool_result', ... }
// Outputs OpenAI-format messages including any assistant-with-tool_calls
// and tool-role result messages required to preserve a multi-turn tool-use
// conversation.
function anthropicMessagesToOpenAI(messages, system) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (!Array.isArray(m.content)) continue;
    const textBlocks = m.content.filter(b => b.type === 'text');
    const toolUseBlocks = m.content.filter(b => b.type === 'tool_use');
    const toolResultBlocks = m.content.filter(b => b.type === 'tool_result');
    if (toolUseBlocks.length) {
      // Assistant turn that requested one or more tool calls.
      out.push({
        role: 'assistant',
        content: textBlocks.map(b => b.text).join('\n') || null,
        tool_calls: toolUseBlocks.map(b => ({
          id: b.id,
          type: 'function',
          function: { name: b.name, arguments: JSON.stringify(b.input) }
        }))
      });
    } else if (toolResultBlocks.length) {
      // OpenAI emits one tool-role message per tool_result.
      for (const b of toolResultBlocks) {
        out.push({
          role: 'tool',
          tool_call_id: b.tool_use_id,
          content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content)
        });
      }
    } else if (textBlocks.length) {
      out.push({ role: m.role, content: textBlocks.map(b => b.text).join('\n') });
    }
  }
  return out;
}

export class OpenAIAdapter {
  constructor(apiKey, { variant = 'openai' } = {}) {
    if (!apiKey) throw new Error(`${variant} API key required`);
    this.providerName = variant;
    const baseURL = variant === 'deepseek' ? 'https://api.deepseek.com/v1' : undefined;
    this.client = new OpenAI({ apiKey, baseURL });
    this._tiers = variant === 'deepseek' ? deepseekTierModels() : openaiTierModels();
  }

  modelForTier(tier) {
    return this._tiers[tier] || this._tiers.balanced;
  }

  async callTool({ system, messages, tool, model, maxTokens = 1500, maxRetries = 2, temperature = 0 }) {
    const m = model || this._tiers.balanced;
    const openaiTool = anthropicToolToOpenAI(tool);
    const openaiMessages = anthropicMessagesToOpenAI(messages, system);
    let attempt = 0;
    while (true) {
      try {
        const response = await this.client.chat.completions.create({
          model: m,
          max_tokens: maxTokens,
          temperature,
          messages: openaiMessages,
          tools: [openaiTool],
          tool_choice: { type: 'function', function: { name: tool.name } }
        });
        const toolCall = response.choices?.[0]?.message?.tool_calls?.[0];
        if (!toolCall) throw new Error('No tool_call in response');
        recordUsage(this.providerName, m, response.usage?.prompt_tokens, response.usage?.completion_tokens);
        let parsed;
        try {
          parsed = JSON.parse(toolCall.function.arguments);
        } catch (e) {
          throw new Error(`Tool arguments not valid JSON: ${e.message}`);
        }
        return parsed;
      } catch (err) {
        attempt++;
        if (attempt > maxRetries) throw err;
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }

  async callText({ system, messages, model, maxTokens = 2000, maxRetries = 2, temperature = 0 }) {
    const m = model || this._tiers.reasoning;
    const openaiMessages = anthropicMessagesToOpenAI(messages, system);
    let attempt = 0;
    while (true) {
      try {
        const response = await this.client.chat.completions.create({
          model: m, max_tokens: maxTokens, temperature, messages: openaiMessages
        });
        recordUsage(this.providerName, m, response.usage?.prompt_tokens, response.usage?.completion_tokens);
        const text = response.choices?.[0]?.message?.content || '';
        return { text, raw: response };
      } catch (err) {
        attempt++;
        if (attempt > maxRetries) throw err;
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }

  async runToolUseLoop({ system, messages, tools, executeTool, maxRounds = 3, model, maxTokens = 1500, temperature = 0 }) {
    const m = model || this._tiers.balanced;
    const openaiTools = tools.map(anthropicToolToOpenAI);
    // Maintain an OpenAI-format conversation since we need to add
    // assistant-with-tool_calls and tool-role messages in OpenAI shape.
    const conversation = anthropicMessagesToOpenAI(messages, system);
    const toolsUsed = [];
    for (let round = 0; round < maxRounds; round++) {
      const response = await this.client.chat.completions.create({
        model: m, max_tokens: maxTokens, temperature,
        messages: conversation, tools: openaiTools
      });
      recordUsage(this.providerName, m, response.usage?.prompt_tokens, response.usage?.completion_tokens);
      const choice = response.choices?.[0]?.message;
      const toolCalls = choice?.tool_calls || [];
      if (!toolCalls.length) {
        return { text: (choice?.content || '').trim(), toolsUsed };
      }
      // Push the assistant's tool-call request as-is so subsequent turns can
      // reference the tool_call_id.
      conversation.push({
        role: 'assistant',
        content: choice.content || null,
        tool_calls: toolCalls
      });
      for (const tc of toolCalls) {
        let input;
        try { input = JSON.parse(tc.function.arguments); } catch { input = {}; }
        toolsUsed.push({ tool: tc.function.name, input });
        let result;
        try {
          result = await executeTool(tc.function.name, input);
        } catch (err) {
          result = { error: err.message?.slice(0, 200) || 'tool execution failed' };
        }
        conversation.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result).slice(0, 8000)
        });
      }
    }
    // Tool budget exhausted — final call with no tools.
    try {
      const finalResponse = await this.client.chat.completions.create({
        model: m, max_tokens: maxTokens, temperature,
        messages: [
          ...conversation,
          { role: 'system', content: 'Tool budget exhausted. Give your final answer in plain text, no more tool calls.' }
        ]
      });
      recordUsage(this.providerName, m, finalResponse.usage?.prompt_tokens, finalResponse.usage?.completion_tokens);
      const text = (finalResponse.choices?.[0]?.message?.content || '').trim();
      return { text: text || '(no response after tool budget)', toolsUsed };
    } catch (err) {
      console.warn(`[${this.providerName}] final-answer call failed:`, err.message);
      return { text: '(failed to produce final answer after tool budget)', toolsUsed };
    }
  }
}
