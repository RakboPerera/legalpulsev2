// Cross-provider token accounting. All adapters call recordUsage() so the
// bake summary, cost dashboard, and rate-limiter share a single counter.
// Module-level state — reset per bake via resetUsage().
const _usage = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  byProvider: {},   // provider → { calls, inputTokens, outputTokens }
  byModel: {}       // model → { provider, calls, inputTokens, outputTokens }
};

// Approximate USD pricing per 1M tokens (2026-05). Update when models change.
// Used for indicative cost only — a Databricks gateway / Azure deployment
// may charge different rates than the public API.
const MODEL_PRICING_PER_M = {
  // Anthropic
  'claude-opus-4-7':           { in: 15, out: 75 },
  'claude-sonnet-4-6':         { in: 3,  out: 15 },
  'claude-haiku-4-5':          { in: 1,  out: 5 },
  'claude-haiku-4-5-20251001': { in: 1,  out: 5 },
  // OpenAI
  'gpt-4.1':       { in: 2,    out: 8 },
  'gpt-4o':        { in: 2.5,  out: 10 },
  'gpt-4o-mini':   { in: 0.15, out: 0.6 },
  // DeepSeek (much cheaper)
  'deepseek-reasoner': { in: 0.55, out: 2.19 },
  'deepseek-chat':     { in: 0.27, out: 1.1 }
};

export function recordUsage(provider, model, inTokens, outTokens) {
  _usage.calls++;
  _usage.inputTokens += inTokens || 0;
  _usage.outputTokens += outTokens || 0;
  if (!_usage.byProvider[provider]) _usage.byProvider[provider] = { calls: 0, inputTokens: 0, outputTokens: 0 };
  _usage.byProvider[provider].calls++;
  _usage.byProvider[provider].inputTokens += inTokens || 0;
  _usage.byProvider[provider].outputTokens += outTokens || 0;
  if (!_usage.byModel[model]) _usage.byModel[model] = { provider, calls: 0, inputTokens: 0, outputTokens: 0 };
  _usage.byModel[model].calls++;
  _usage.byModel[model].inputTokens += inTokens || 0;
  _usage.byModel[model].outputTokens += outTokens || 0;
}

export function getUsageReport() {
  let estimatedCostUsd = 0;
  for (const [model, m] of Object.entries(_usage.byModel)) {
    const price = MODEL_PRICING_PER_M[model];
    if (!price) continue;
    estimatedCostUsd += (m.inputTokens * price.in + m.outputTokens * price.out) / 1_000_000;
  }
  return {
    ..._usage,
    estimatedCostUsd: Math.round(estimatedCostUsd * 1000) / 1000
  };
}

export function resetUsage() {
  _usage.calls = 0;
  _usage.inputTokens = 0;
  _usage.outputTokens = 0;
  _usage.byProvider = {};
  _usage.byModel = {};
}
