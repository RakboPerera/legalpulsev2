// LLM-driven signal classifier. Replaces the keyword-regex
// `classifySignalHeuristic` in scripts/bake-helpers.js, which over-flagged
// ~80% of Tavily news as "legally significant" because partner-language
// keywords ("regulation", "litigation", "merger") appear casually in
// passing prose. A senior partner reading 245 articles wouldn't find 196
// worth pursuing.
//
// Two entry points:
//   - classifySignal(signal, { apiKey })           — single-call (Haiku);
//     used by the runtime event-intelligence engine in backend/engines.
//   - classifySignalsLLM(signals, apiKey, fallback) — batched (~20/call);
//     used by the bake script to classify the full pool with low overhead.
//
// Both share the same ruthless senior-partner prompt and topic taxonomy.

import { callTool, MODELS } from './client.js';

const SYSTEM_PROMPT = `You are a senior business-development analyst at a top-tier law firm. Your job is to triage news / regulatory / market signals and decide which ones are REAL legal triggers that create business-development opportunity, vs. noise.

How a senior partner triages — examples:

REAL legal triggers (significant = true):
- Lawsuit FILED, class action certified, regulator opening enforcement action
- Court ruling against a corporate party, settlement disclosed, consent decree
- Announced M&A transaction, tender offer, divestiture, hostile bid
- Sanctions designation of a SPECIFIC entity (not substring matches against unrelated foreign companies)
- Regulator adopting / enforcing rule that materially affects a sector
- Fine, penalty, criminal indictment, prohibition order
- Material adverse change, restatement, going concern, cyber/data breach disclosed
- Patent infringement suit filed, ITC complaint, post-grant review initiated
- Force-majeure event affecting transit/contracts (Hormuz, Red Sea, sanctions on supply chain)
- Geopolitical disruption with concrete corporate impact (asset seizure, vessel detention, expropriation)
- Executive departure under pressure, GC change, CCO appointment

NOT triggers (significant = false):
- Routine quarterly filings (10-Q, 10-K, 6-K) WITHOUT material litigation/disclosure markers
- Analyst notes, "watching" commentary, sector outlooks
- Industry-wide chatter that names many parties without singling one out
- Routine corporate updates: dividends, AGMs, ratings affirmations
- Sanctions list entries against entities with similar names but no real connection (substring collisions like "ORIENTAL APPLE" vs Apple Inc.)
- Lawyer/firm hire announcements ("Paul Weiss adds X")
- Market commentary about stock moves
- Broad macroeconomic news
- Speculation about possible future actions ("X may consider Y")
- Press releases announcing earnings beats / share buybacks (unless tied to a specific legal trigger)

Default to significant=false unless the trigger is concrete and named. Be ruthless — empty fields are not allowed; if the signal has no real trigger, set significant=false and topic='general'.

Event topic taxonomy — pick the SINGLE best match:
- litigation_general — broad litigation/disputes not fitting a more specific bucket
- securities_litigation — securities class actions, SEC enforcement, fraud claims
- class_actions — consumer / product / privacy class actions
- patent_litigation — patent infringement, ITC, PGR
- trade_secrets — misappropriation, IP theft
- m_and_a — announced deals, takeovers, divestitures
- merger_control — antitrust review of pending deals (CMA, DG COMP, FTC, DOJ)
- ofac_sanctions — OFAC designations, US sanctions
- eu_uk_sanctions — EU consolidated, UK OFSI
- export_controls — BIS, dual-use, semiconductor export rules
- regulatory_enforcement — agency action, fine, consent decree (non-sanctions)
- regulatory_rulemaking — proposed/adopted rules with material industry impact
- ai_regulation — AI Act, generative AI guidance, AI-specific enforcement
- esg_climate — climate litigation, emissions, ESG disclosure
- cyber_data — breach, ransomware, data protection enforcement
- restructuring — Chapter 11, scheme of arrangement, distressed
- finance_lending — leveraged loans, acquisition finance, syndicated debt
- force_majeure — Hormuz, Red Sea, geopolitical disruption with contract impact
- decommissioning — late-life asset, abandonment, plug-and-abandon
- product_liability — recall, safety defect, consumer harm
- employment_executive — GC departure, exec change under pressure, labour dispute
- fdi_screening — national-security review, CFIUS-style filing
- general — significant but doesn't fit any topic above`;

// Single-signal classifier (used by runtime engine paths). Output schema
// matches what the heuristic produces so downstream code doesn't need to
// branch on classifier type.
const SINGLE_TOOL = {
  name: 'classify_signal',
  description: 'Classify whether a single signal is a real legal trigger and pick its event topic.',
  input_schema: {
    type: 'object',
    properties: {
      isLegallySignificant: { type: 'boolean' },
      reason: { type: 'string', description: '1-sentence justification' },
      affectedIndustries: { type: 'array', items: { type: 'string' } },
      candidatePracticeAreas: { type: 'array', items: { type: 'string' } },
      eventTopic: { type: 'string', description: 'Topic from the supplied taxonomy.' }
    },
    required: ['isLegallySignificant', 'reason', 'eventTopic']
  }
};

const KNOWN_TOPICS = new Set([
  'litigation_general', 'securities_litigation', 'class_actions',
  'patent_litigation', 'trade_secrets', 'm_and_a', 'merger_control',
  'ofac_sanctions', 'eu_uk_sanctions', 'export_controls',
  'regulatory_enforcement', 'regulatory_rulemaking', 'ai_regulation',
  'esg_climate', 'cyber_data', 'restructuring', 'finance_lending',
  'force_majeure', 'decommissioning', 'product_liability',
  'employment_executive', 'fdi_screening', 'general'
]);

function prettifyTopic(t) {
  return (t || 'general').replace(/_/g, ' ');
}

export async function classifySignal(signal, { apiKey, provider } = {}) {
  const userPrompt = `Classify this signal:
Source: ${signal.source}
Title: ${signal.title}
Description: ${(signal.description || '').slice(0, 600)}
Published: ${signal.publishedAt}
Jurisdictions: ${(signal.jurisdictions || []).join(', ')}`;
  const out = await callTool({
    apiKey, provider,
    model: MODELS.haiku,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    tool: SINGLE_TOOL,
    maxTokens: 600
  });
  if (out.eventTopic) out.eventTopic = prettifyTopic(KNOWN_TOPICS.has(out.eventTopic) ? out.eventTopic : 'general');
  return out;
}

// Batched classifier for bake-time use. ~20 signals per call, output 1:1.
const BATCH_TOOL = {
  name: 'classify_signals',
  description: 'Classify a batch of signals 1:1.',
  input_schema: {
    type: 'object',
    properties: {
      classifications: {
        type: 'array',
        description: 'Array aligned to input batch by idx.',
        items: {
          type: 'object',
          properties: {
            idx: { type: 'integer', description: 'Index from input batch (0-based).' },
            significant: { type: 'boolean' },
            topic: { type: 'string', description: 'Topic from the supplied taxonomy.' },
            reason: { type: 'string', description: '1-sentence justification.' }
          },
          required: ['idx', 'significant', 'topic']
        }
      }
    },
    required: ['classifications']
  }
};

function compactSignal(s, idx) {
  const desc = (s.description || '').slice(0, 350);
  const date = (s.publishedAt || '').slice(0, 10);
  return `[${idx}] (${s.source}, ${date}) "${(s.title || '').slice(0, 200)}"${desc ? ` — ${desc}` : ''}`;
}

async function classifyBatch(batch, apiKey, provider) {
  const lines = batch.map(compactSignal).join('\n');
  const userPrompt = `Classify these ${batch.length} signals. Return idx + significant + topic + 1-sentence reason for each. Be ruthless; default to significant=false unless the trigger is concrete and named.\n\n${lines}`;
  const out = await callTool({
    apiKey, provider,
    model: MODELS.haiku,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    tool: BATCH_TOOL,
    maxTokens: 2500
  });
  return out.classifications || [];
}

// Mutates each signal in-place to set:
//   isLegallySignificant, legalSignificanceReason, eventTopic, classifiedAt, classifiedBy
//
// Falls back to per-signal heuristic when LLM unavailable, or per-batch
// when an individual batch errors. Returns counts for telemetry.
export async function classifySignalsLLM(signals, apiKey, heuristicFallback, provider) {
  const BATCH_SIZE = 20;
  let llmHits = 0;
  let fallbackHits = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < signals.length; i += BATCH_SIZE) {
    const batch = signals.slice(i, i + BATCH_SIZE);
    let results = null;
    try {
      results = await classifyBatch(batch, apiKey, provider);
    } catch (err) {
      console.warn(`[classifier] batch ${i}-${i + batch.length} failed (${err.message?.slice(0, 80)}); falling back to heuristic for this batch`);
    }
    const byIdx = new Map();
    if (Array.isArray(results)) {
      for (const r of results) {
        if (typeof r.idx === 'number' && r.idx >= 0 && r.idx < batch.length) byIdx.set(r.idx, r);
      }
    }
    for (let j = 0; j < batch.length; j++) {
      const sig = batch[j];
      const r = byIdx.get(j);
      if (r && typeof r.significant === 'boolean') {
        const topic = KNOWN_TOPICS.has(r.topic) ? r.topic : 'general';
        sig.isLegallySignificant = r.significant;
        sig.legalSignificanceReason = r.reason || (r.significant ? 'LLM-classified significant' : 'LLM-classified noise');
        sig.eventTopic = prettifyTopic(topic);
        sig.classifiedAt = now;
        sig.classifiedBy = 'llm';
        // Keep heuristic-derived industry/practice fields if they were
        // pre-computed; populate empty arrays if not.
        sig.affectedIndustries = sig.affectedIndustries || [];
        sig.candidatePracticeAreas = sig.candidatePracticeAreas || [];
        llmHits++;
      } else {
        const h = heuristicFallback ? heuristicFallback(sig) : { isLegallySignificant: false, reason: 'no classifier', eventTopic: 'general', affectedIndustries: [], candidatePracticeAreas: [] };
        sig.isLegallySignificant = h.isLegallySignificant;
        sig.legalSignificanceReason = h.reason;
        sig.eventTopic = h.eventTopic;
        sig.affectedIndustries = h.affectedIndustries || [];
        sig.candidatePracticeAreas = h.candidatePracticeAreas || [];
        sig.classifiedAt = now;
        sig.classifiedBy = 'heuristic-fallback';
        fallbackHits++;
      }
    }
  }
  return { llmHits, fallbackHits };
}
