// Thin compat shim over backend/lib/llm. Public surface (callTool / callText
// / MODELS / hasAmbientLLMAccess / getUsageReport / resetUsage) is unchanged
// so existing agent files don't need to be rewritten — they pass their
// existing apiKey + model and the new `provider` argument routes the call
// to the right adapter.
//
// The actual provider dispatch lives in lib/llm/index.js. This file stays
// because:
//   - 15 agent files import { callTool, callText, MODELS } from it
//   - the bake script imports { hasAmbientLLMAccess, getUsageReport,
//     resetUsage } from it
// Rewriting all those imports would bloat the diff without any architectural
// benefit. The shim is ~50 LOC and routes everything through lib/llm.

import 'dotenv/config';
import {
  getLLMClient,
  detectBakeProvider,
  recordUsage,
  getUsageReport as _getUsageReport,
  resetUsage as _resetUsage
} from '../lib/llm/index.js';

// Default tier-to-tag mapping. Historically the codebase used MODELS.opus
// for "best reasoning", MODELS.sonnet for "balanced", MODELS.haiku for
// "fast". We keep those names for callsite stability — the adapter
// re-maps them onto whichever provider's actual models. Each entry is the
// TIER name; the adapter resolves tier → concrete model.
export const MODELS = {
  opus: 'reasoning',
  sonnet: 'balanced',
  haiku: 'fast'
};

// For the bake script and any caller that needs to know whether the runtime
// can make LLM calls without per-request keys. With BYOK in production the
// answer at runtime is always false (each request supplies its own key).
// At bake time it's true iff one of the provider env vars is set.
export function hasAmbientLLMAccess() {
  return detectBakeProvider() !== null;
}

// Resolve the provider+key from the call arguments. Three input shapes are
// accepted for back-compat:
//   1. callTool({ apiKey, provider, ... })          — new explicit form
//   2. callTool({ apiKey, ... })                    — legacy; provider falls
//      back to bake env detection or 'anthropic'
//   3. Called inside a route handler — caller threads req.user.llmProvider
//      and req.user.providerApiKey explicitly.
function resolveCredentials(args) {
  const { apiKey, provider } = args;
  if (apiKey && provider) return { apiKey, provider };
  if (apiKey && !provider) {
    // Legacy callers (still passing only apiKey) — assume anthropic, which
    // is what the codebase has always meant by "the api key".
    return { apiKey, provider: 'anthropic' };
  }
  // No per-call credentials — fall back to bake env detection.
  const bake = detectBakeProvider();
  if (bake) return bake;
  throw new Error('No LLM credentials available — pass { apiKey, provider } or set ANTHROPIC_API_KEY / OPENAI_API_KEY / DEEPSEEK_API_KEY in env.');
}

// Map a legacy model "name" (opus/sonnet/haiku) to a tier. If the caller
// already passed a tier name or a raw model ID, return as-is — the adapter
// handles the actual resolution.
function resolveTier(modelArg) {
  if (!modelArg) return 'balanced';
  if (modelArg === 'opus' || modelArg === 'reasoning') return 'reasoning';
  if (modelArg === 'sonnet' || modelArg === 'balanced') return 'balanced';
  if (modelArg === 'haiku' || modelArg === 'fast') return 'fast';
  // Unknown — assume it's a concrete model ID, pass it through and let the
  // adapter resolve it.
  return modelArg;
}

// Default temperature 0 preserved at the shim so callsites that don't
// specify (most of them) still get reproducible outputs on Sonnet/Haiku.
// The adapter is responsible for suppressing the field on models that
// reject it (e.g. Opus 4.x — see anthropic.js#modelRejectsTemperature).
export async function callTool({ apiKey, provider, model, system, messages, tool, maxTokens, maxRetries, temperature = 0 }) {
  const cred = resolveCredentials({ apiKey, provider });
  const client = getLLMClient(cred.provider, cred.apiKey);
  const tier = resolveTier(model);
  const resolvedModel = ['reasoning', 'balanced', 'fast'].includes(tier)
    ? client.modelForTier(tier)
    : tier;
  return client.callTool({
    system, messages, tool, model: resolvedModel,
    maxTokens, maxRetries, temperature
  });
}

export async function callText({ apiKey, provider, model, system, messages, maxTokens, maxRetries, temperature = 0 }) {
  const cred = resolveCredentials({ apiKey, provider });
  const client = getLLMClient(cred.provider, cred.apiKey);
  const tier = resolveTier(model);
  const resolvedModel = ['reasoning', 'balanced', 'fast'].includes(tier)
    ? client.modelForTier(tier)
    : tier;
  return client.callText({
    system, messages, model: resolvedModel,
    maxTokens, maxRetries, temperature
  });
}

// Native tool-use loop. Used by eventChatAgent — gives the chat agent a
// provider-agnostic way to run multi-turn tool-use without reaching for
// the Anthropic SDK directly.
export async function runToolUseLoop({ apiKey, provider, system, messages, tools, executeTool, maxRounds, model, maxTokens, temperature = 0 }) {
  const cred = resolveCredentials({ apiKey, provider });
  const client = getLLMClient(cred.provider, cred.apiKey);
  const tier = resolveTier(model);
  const resolvedModel = ['reasoning', 'balanced', 'fast'].includes(tier)
    ? client.modelForTier(tier)
    : tier;
  return client.runToolUseLoop({
    system, messages, tools, executeTool, maxRounds,
    model: resolvedModel, maxTokens, temperature
  });
}

export const getUsageReport = _getUsageReport;
export const resetUsage = _resetUsage;
export { recordUsage };
