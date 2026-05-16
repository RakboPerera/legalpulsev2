// Provider-dispatching factory. Every agent in the codebase goes through
// getLLMClient(provider, apiKey) — no agent imports Anthropic / OpenAI SDKs
// directly. Adding a new provider means adding one adapter + one branch here.

import crypto from 'crypto';
import { AnthropicAdapter } from './anthropic.js';
import { OpenAIAdapter } from './openai.js';

export const SUPPORTED_PROVIDERS = ['anthropic', 'openai', 'deepseek'];

export function isValidProvider(p) {
  return typeof p === 'string' && SUPPORTED_PROVIDERS.includes(p);
}

// Adapter instances are cached per (provider, apiKey) signature so we don't
// re-construct the SDK client on every callTool — saves ~5ms per call and
// keeps connection pools warm.
//
// Cache key: SHA-256 of `${provider}:${apiKey}`. A previous version used
// the LAST 8 CHARS of the apiKey, which created cross-user collision risk
// in multi-tenant deployments (two distinct keys with the same last-8
// characters served the same adapter, with credentials from the first
// caller). Full-key hashing eliminates that. LRU cap of 100 prevents
// unbounded growth on long-running processes with many distinct users.
const _cache = new Map();
const CACHE_MAX = 100;

function cacheKey(provider, apiKey) {
  if (!apiKey) return `${provider}:no-key`;
  const hash = crypto.createHash('sha256').update(`${provider}:${apiKey}`).digest('hex');
  return hash;
}

// LRU-touch: move the just-used key to the end of the Map's insertion order
// so it's evicted last. Map iteration order is insertion order; deleting + re-
// inserting puts it at the tail.
function touch(key) {
  if (!_cache.has(key)) return;
  const v = _cache.get(key);
  _cache.delete(key);
  _cache.set(key, v);
}

function evictIfFull() {
  if (_cache.size <= CACHE_MAX) return;
  // Map iteration order = insertion order → first key is the least recently
  // touched. Drop one.
  const firstKey = _cache.keys().next().value;
  if (firstKey) _cache.delete(firstKey);
}

export function getLLMClient(provider, apiKey) {
  if (!isValidProvider(provider)) {
    throw new Error(`Unsupported LLM provider: ${provider}. Use one of ${SUPPORTED_PROVIDERS.join(', ')}.`);
  }
  if (!apiKey) {
    throw new Error(`LLM API key required (provider=${provider}).`);
  }
  const key = cacheKey(provider, apiKey);
  if (_cache.has(key)) {
    touch(key);
    return _cache.get(key);
  }
  let client;
  switch (provider) {
    case 'anthropic':
      client = new AnthropicAdapter(apiKey);
      break;
    case 'openai':
      client = new OpenAIAdapter(apiKey, { variant: 'openai' });
      break;
    case 'deepseek':
      client = new OpenAIAdapter(apiKey, { variant: 'deepseek' });
      break;
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
  _cache.set(key, client);
  evictIfFull();
  return client;
}

// Bake-time provider resolution: pick the first env-configured provider. The
// bake is operator-controlled (it's a build step, not user-facing), so the
// operator chooses which provider to use by setting that provider's env var.
// Precedence is anthropic → openai → deepseek for back-compat with the
// existing demo bake which used ANTHROPIC_API_KEY.
export function detectBakeProvider() {
  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY };
  }
  if (process.env.OPENAI_API_KEY) {
    return { provider: 'openai', apiKey: process.env.OPENAI_API_KEY };
  }
  if (process.env.DEEPSEEK_API_KEY) {
    return { provider: 'deepseek', apiKey: process.env.DEEPSEEK_API_KEY };
  }
  return null;
}

// Validate a key by making the smallest possible call. Used by the BYOK
// settings page's "Save & verify" flow so users don't persist an invalid
// key. Returns { ok: true, model } or { ok: false, error }.
export async function validateProviderKey(provider, apiKey) {
  if (!isValidProvider(provider)) return { ok: false, error: 'invalid_provider' };
  if (!apiKey || typeof apiKey !== 'string') return { ok: false, error: 'invalid_key' };
  try {
    // Bypass the cache — validation is one-shot and we don't want a bad key
    // poisoning the cache for the next legitimate request.
    let client;
    if (provider === 'anthropic') client = new AnthropicAdapter(apiKey);
    else client = new OpenAIAdapter(apiKey, { variant: provider });
    const model = client.modelForTier('fast');
    const result = await client.callText({
      model,
      maxTokens: 5,
      maxRetries: 0,
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }]
    });
    return { ok: true, model, sample: (result.text || '').slice(0, 40) };
  } catch (err) {
    return { ok: false, error: err.message?.slice(0, 200) || 'validation_failed' };
  }
}

export { recordUsage, getUsageReport, resetUsage } from './usage.js';
