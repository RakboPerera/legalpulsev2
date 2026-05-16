// Workspace-scoped Event Inquiry agent.
//
// Different from eventChatAgent (which is invoked from a pre-extracted
// event cluster on the Market Screening detail page) — this agent runs
// when the partner types a free-form question on the Event Inquiry tab,
// e.g. "Russia just sanctioned 14 European banks — who's exposed?" or
// "FDA issued a Form 483 to Pfizer's Sligo plant — what's the play?".
//
// The architecture reuses the existing tool-use loop from eventChatAgent
// by synthesizing a minimal event descriptor from the partner's message.
// That keeps both surfaces converged on a single agent + system prompt
// so behaviour (tavily search, identify_opportunities, system prompt
// voice) stays consistent.
//
// Returns the same shape as runEventChatAgent: { content, toolsUsed,
// generatedOpps }. The route handler exposes generatedOpps without
// persisting — the partner reviews them in the UI and clicks Save on
// each one they want.

import { runEventChatAgent } from './eventChatAgent.js';

// Build a synthetic event from the user's message so the downstream
// agent's prompt scaffolding (`compactEvent`) has something to work
// with. Real fields are populated by tavily_search results once the
// agent fetches them.
function synthesizeEventFromMessage(message) {
  // ISO-week of today — matches eventChatAgent's expectation.
  const now = new Date();
  const onejan = new Date(now.getFullYear(), 0, 1);
  const weekNumber = Math.ceil((((now - onejan) / 86400000) + onejan.getDay() + 1) / 7);
  return {
    eventTopic: 'partner_inquiry',
    headline: message.slice(0, 200),
    week: `${now.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`,
    jurisdictions: [],
    industries: [],
    signalCount: 0,
    sourceCount: 0,
    // Marker so the agent prompt can distinguish this from a real event cluster.
    isPartnerInquiry: true
  };
}

export async function runEventInquiryAgent({ workspace, message, history = [], apiKey, provider }) {
  const event = synthesizeEventFromMessage(message);
  // signals: [] — the agent is expected to use tavily_search to gather
  // fresh context, then call identify_opportunities. Initially nothing
  // is in the pool.
  return runEventChatAgent({
    event,
    signals: [],
    workspace,
    message,
    history,
    apiKey,
    provider
  });
}
