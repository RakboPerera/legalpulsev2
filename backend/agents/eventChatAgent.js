// Per-event chat agent — invoked from the Outreach > Market Screening
// event-detail page. The partner clicks an event cluster and lands in a
// chat where they can interrogate the event with a senior-partner-grade
// AI that has TWO tools:
//
//   1. tavily_search — live web search for fresh context (regulatory
//      history, similar precedents, related news), bounded to the last
//      N days. Use when the partner asks something the cached signals
//      don't cover.
//   2. identify_opportunities — runs the firm's screener on this event
//      cluster and returns proposed BD opportunities (existing roster
//      entities + newly-discovered prospects) with structured rationale.
//      Does NOT persist anything; the partner can then say "save these"
//      to commit them to the workspace.
//
// Multi-turn tool use is bounded to 3 rounds per user message so a
// runaway agent can't burn unbounded LLM calls.
//
// The provider-specific tool-use loop now lives in lib/llm/{anthropic,
// openai}.js — this file is pure prompt + tool-execution logic.

import { runToolUseLoop, MODELS } from './client.js';
import { fetchTavilySignalsForTheme } from '../sources/tavily.js';
import { generateOppsFromEvent } from './marketScreeningAgent.js';

const SYSTEM_PROMPT = `You are a senior business-development partner at a top-tier law firm. The user has clicked on a specific market event in the Market Screening workflow and wants to understand it.

Your job in this conversation:
- Help the partner understand WHAT the event is — the underlying happening, the corporate parties involved, the legal-substantive nature of it.
- Help them figure out WHICH ENTITIES are exposed and what specific legal mandates the event creates.
- Pull fresh context when the partner asks something the cached signals don't cover — using the tavily_search tool.
- Identify concrete BD opportunities when asked — using the identify_opportunities tool.

Voice and style:
- Direct, partner-to-partner. No "Great question", no "I'd be happy to help". Just answer.
- Cite specific signal sources, dates, court dockets, dollar amounts when you have them.
- When you use tavily_search, summarise the new findings in 2-4 sentences and cite the source titles + dates inline.
- When you use identify_opportunities, present each returned opp as a one-line summary + 1-sentence rationale, grouped by existing-roster vs new-prospect entities.
- Be ruthless about evidence. If a signal is single-source, low-tier, or off-topic, say so. The partner trusts honesty over enthusiasm.
- No marketing language. No "synergistic", "leverage", "comprehensive solution".
- Keep responses tight — 2-6 sentences for most answers, with bullets only when the answer has parallel parts.

Tool use guidance:
- Use tavily_search when the partner asks for context that's not in the cached event signals — e.g., "what's [entity]'s recent regulatory history?", "have similar [type] motions succeeded recently?", "is this related to the [other case]?".
- Use identify_opportunities when the partner asks about BD opportunities, who's exposed, or "what should we do about this?".
- Do NOT call tools on every message. Often the cached event context already has the answer.
- After a tool returns, integrate its output into your reply — don't just dump the tool result.

Compliance: if the event is a sanctions designation, OFAC/OFSI hit, or other compliance-trigger event, advise escalation rather than outreach.`;

const TOOLS = [
  {
    name: 'tavily_search',
    description: 'Search the web for fresh news / regulatory commentary / case law on a focused query. Use when the partner asks for context the cached event signals don\'t cover. Returns 5-8 result entries with title, URL, content excerpt, and date.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Focused search query — be specific (entity + topic + jurisdiction).' },
        days: { type: 'number', description: 'How many days back to search. Default 30. Use larger value (180+) for "history" questions.' }
      },
      required: ['query']
    }
  },
  {
    name: 'identify_opportunities',
    description: 'Run the firm\'s opportunity screener on this event cluster. Returns 1-5 proposed BD opportunities — existing roster entities and any newly-discovered prospects — with service, partner suggestion, and rationale. Does not persist anything. Use when the partner asks who is exposed or what mandates this event creates.',
    input_schema: { type: 'object', properties: {}, required: [] }
  }
];

function compactEvent(event, signals) {
  return `EVENT: ${event.headline || event.eventTopic}
Topic: ${event.eventTopic} | Week: ${event.week} | ${event.signalCount || signals?.length} signal(s) from ${event.sourceCount} source(s)
Jurisdictions: ${(event.jurisdictions || []).join(', ') || 'n/a'}
Industries: ${(event.industries || []).join(', ') || 'n/a'}

CACHED SIGNALS (already in our pool — partner has these but may want fresher context):
${(signals || []).slice(0, 6).map((s, i) => `  [${i+1}] [${s.source}] ${s.title?.slice(0, 160)} (${(s.publishedAt || '').slice(0,10)})${s.description ? '\n      ' + s.description.slice(0, 250) : ''}`).join('\n')}`;
}

async function runTavilySearch({ query, days = 30 }) {
  try {
    const sigs = await fetchTavilySignalsForTheme(query, { days, maxRecords: 6 });
    if (!sigs.length) return { results: [], note: 'No fresh results from web search.' };
    return {
      results: sigs.map(s => ({
        title: (s.title || '').slice(0, 200),
        url: s.sourceUrl,
        date: (s.publishedAt || '').slice(0, 10),
        excerpt: (s.description || '').slice(0, 400)
      }))
    };
  } catch (err) {
    return { results: [], error: err.message?.slice(0, 100) };
  }
}

async function runIdentifyOpportunities({ event, signals, workspace, apiKey, provider }) {
  try {
    const result = await generateOppsFromEvent({ event, signals, workspace, apiKey, provider });
    return {
      eventInterpretation: result.eventInterpretation,
      opportunities: (result.opportunities || []).map(o => ({
        entity: o.entityRef?.existingId
          ? (workspace.clients.concat(workspace.prospects).find(e => e.id === o.entityRef.existingId)?.legalName || o.entityRef.existingId)
          : o.entityRef?.newProspect?.legalName || 'unknown',
        isNewProspect: !!o.entityRef?.newProspect,
        service: o.service,
        urgency: o.urgency,
        confidence: o.confidence,
        score: o.score,
        summary: o.summary,
        reasoning: o.reasoning
      }))
    };
  } catch (err) {
    return { error: err.message?.slice(0, 200), opportunities: [] };
  }
}

const MAX_TOOL_ROUNDS = 3;

export async function runEventChatAgent({ event, signals, workspace, message, history = [], apiKey, provider }) {
  const eventBlock = compactEvent(event, signals);
  // Initial messages — history + event context + current question. History is
  // capped at the last 10 turns so we don't grow the conversation indefinitely.
  const messages = [
    ...history.filter(m => m.role === 'user' || m.role === 'assistant').slice(-10).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: `${eventBlock}\n\nPARTNER QUESTION: ${message}` }
  ];

  // Tool executor — closes over event/signals/workspace so each tool call
  // sees the same opportunity context. We capture the typed payload of
  // identify_opportunities via a side-effect on `inlineGeneratedOpps` so
  // the route handler can return it to the frontend without re-running
  // the agent (which would cost a second LLM call and could return
  // different results due to non-determinism).
  let inlineGeneratedOpps = null;
  const executeTool = async (name, input) => {
    if (name === 'tavily_search') return runTavilySearch(input);
    if (name === 'identify_opportunities') {
      const result = await runIdentifyOpportunities({ event, signals, workspace, apiKey, provider });
      if (Array.isArray(result.opportunities) && result.opportunities.length) {
        inlineGeneratedOpps = result;
      }
      return result;
    }
    return { error: `Unknown tool: ${name}` };
  };

  const result = await runToolUseLoop({
    apiKey, provider,
    system: SYSTEM_PROMPT,
    messages,
    tools: TOOLS,
    executeTool,
    maxRounds: MAX_TOOL_ROUNDS,
    model: MODELS.sonnet,
    maxTokens: 1500
  });

  return {
    content: result.text || '(no response)',
    toolsUsed: result.toolsUsed,
    generatedOpps: inlineGeneratedOpps
  };
}
