import { callText, MODELS } from './client.js';

const SYSTEM_PROMPT = `You are the LegalPulse Q&A agent, embedded in a legal BD intelligence platform. You answer questions about the workspace's opportunities, signals, clients, matters, and audit trail.

Be concise — partners want answers, not paragraphs. Cite specific opportunity IDs, signal sources, or matter IDs where relevant. When citing a source URL include it inline as a markdown link. If the user asks for something you don't have data for, say so plainly.

Style: direct, no marketing language, no hedging beyond what the evidence requires. Section headers only if the answer genuinely has multiple parts.`;

function compactWorkspaceContext(workspace) {
  return {
    firm: workspace.firmProfile?.name,
    clients: (workspace.clients || []).slice(0, 20).map(c => ({ id: c.id, name: c.legalName, sector: c.sector })),
    prospects: (workspace.prospects || []).slice(0, 10).map(p => ({ id: p.id, name: p.legalName, sector: p.sector })),
    opportunities: (workspace.opportunities || []).slice(0, 50).map(o => ({
      id: o.id, type: o.type, entity: o.entity, service: o.suggestedService,
      urgency: o.urgencyTier, score: o.score,
      summary: o.basis?.summary
    })),
    recentSignals: (workspace.signals || []).slice(-30).map(s => ({
      id: s.id, source: s.source, title: s.title, publishedAt: s.publishedAt,
      url: s.sourceUrl, entityMentions: (s.entities || []).map(e => e.entityId).filter(Boolean)
    }))
  };
}

export async function runChatAgent({ workspace, message, apiKey, provider }) {
  const recentHistory = (workspace.chatHistory || []).slice(-10);
  const ctx = compactWorkspaceContext(workspace);
  const userPrompt = `Workspace snapshot (JSON, abridged):
${JSON.stringify(ctx).slice(0, 8000)}

User question: ${message}`;

  const messages = [
    ...recentHistory
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userPrompt }
  ];

  const { text } = await callText({
    apiKey, provider,
    model: MODELS.opus,
    system: SYSTEM_PROMPT,
    messages,
    maxTokens: 1500
  });

  const citations = [];
  const cite = /(opp-[a-f0-9]{8,}|sig-[a-f0-9]{8,}|M-\d{4}-\d{3,})/g;
  let m;
  while ((m = cite.exec(text)) !== null) citations.push({ ref: m[1] });

  return { content: text, citations };
}

// Per-opportunity chat agent. The system prompt is opportunity-focused; the
// user prompt embeds the full opportunity, the cited signals (with excerpts),
// the relevant matters, the briefing, and the entity profile. The agent's job
// is to help the partner *understand the insights* — what the source data
// says, why this opportunity makes sense, what the precedent is, and what
// would change the assessment.
const OPPORTUNITY_CHAT_SYSTEM = `You are a senior business-development partner at a top-tier law firm, sitting alongside the partner who owns this opportunity. They've opened the chat to think through it with you. Treat the conversation as a private partner-to-partner conversation, not a customer-facing chatbot.

Your knowledge base — what you draw on:
- Decades of experience reading filings, regulatory actions, and court records to spot legal triggers.
- Working understanding of every major practice area: M&A and merger control, securities litigation, sanctions and export controls, patent / IP, regulatory defense, restructuring, employment, ESG / climate litigation, financial-services regulation, antitrust / competition.
- How law firms actually win mandates: relationship continuity, conflict checks, partner-fit, pricing, GC procurement processes, RFP cycles, beauty parades.
- The difference between a real legal trigger and noise — routine 10-Q paperwork, analyst hedging, industry-wide news, substring sanctions FPs, third-party-of-an-event chatter.

How to answer:
- Lead with the substance. If the partner asks "is this real?", give them your verdict in the first line, then the reasoning.
- Cite specific evidence — signal titles, source/date, matter IDs (M-2024-XXXX), practice-area precedents — by reference, not by quoting blocks.
- When you assess strength, say what would tighten or weaken the case ("if the FT confirms the diversion is permanent, this moves from steady-state to immediate"). Partners want to know what to watch.
- Map the event to the legal work concretely: which clauses activate, which proceedings open, which jurisdictions matter, which specific deliverable the firm would produce. Avoid practice-area abstractions.
- Treat the cited signals + briefing + matter list as the authoritative record. If the partner asks something you can answer from that record, do. If they ask something outside it (e.g. "what does the GC's procurement history look like?"), say plainly what's known and what isn't.
- Reference past matters when the analogy is real — "we did similar in M-2024-0455 (Maersk Hormuz) — the same force-majeure analysis applies here". Do not list matters as filler.

Voice:
- Direct, sharp, partner-to-partner. No "I'd be happy to help", no "Great question". Just answer.
- Confident where the evidence supports confidence; honest about uncertainty where it doesn't. A senior partner says "we'd need to confirm X before pitching" — they don't pretend the signal is stronger than it is.
- No marketing language. No "synergistic", "leverage relationships", "comprehensive solution", "robust framework", "best-in-class". The partner reading this would close the chat in disgust.
- Concise. Default 2-5 sentences for most questions. Bullet only when the answer genuinely has parallel parts (e.g. "three things would tighten this assessment: (1)... (2)... (3)..."). Section headers only for genuinely multi-part replies.

Compliance escalations:
- If the opportunity is flagged isSanctionsAlert: true, do NOT propose outreach. Tell the partner to escalate to compliance, name what specifically needs to be verified (e.g. "confirm whether the SDN match is the same legal entity as our target — substring matches against ORIENTAL APPLE COMPANY PTE LTD do not implicate Apple Inc."), and stop.

Never:
- Invent facts not in the supplied context.
- Confidently extrapolate from signals you flagged as weak — if the briefing says "weak signal", treat it as weak in your reply too.
- Suggest the partner pitch on a thin signal just because they asked. If the case is weak, say so. The partner will respect honesty over enthusiasm.`;

function compactOpportunityContext({ workspace, opportunity, entity, signals, briefing, entityMatters }) {
  return {
    firm: workspace.firmProfile?.name,
    opportunity: {
      id: opportunity.id,
      type: opportunity.type,
      engineSource: opportunity.engineSource,
      service: opportunity.suggestedService,
      urgency: opportunity.urgencyTier,
      score: opportunity.score,
      confidence: opportunity.confidence,
      summary: opportunity.basis?.summary,
      reasoning: opportunity.basis?.reasoning,
      isSanctionsAlert: !!opportunity.isSanctionsAlert
    },
    entity: entity ? {
      id: entity.id,
      legalName: entity.legalName,
      sector: entity.sector,
      subSector: entity.subSector,
      hqJurisdiction: entity.hqJurisdiction,
      countriesOfOperation: entity.countriesOfOperation,
      size: entity.size,
      decisionMakers: entity.decisionMakers,
      relationshipMaturity: entity.relationshipMaturity
    } : null,
    citedSignals: (signals || []).map(s => ({
      id: s.id,
      source: s.source,
      title: s.title,
      publishedAt: s.publishedAt,
      url: s.sourceUrl,
      excerpt: (s.description || '').slice(0, 400)
    })),
    briefing: briefing ? {
      headline: briefing.basis?.oneLineHeadline,
      detailedExplanation: briefing.basis?.detailedExplanation,
      talkingPoints: briefing.talkingPoints,
      timingRecommendation: briefing.timingRecommendation
    } : null,
    entityMatters: (entityMatters || []).map(m => ({
      id: m.id,
      title: m.matterTitle,
      services: m.services,
      leadPartner: m.leadPartner,
      year: m.year || m.startedAt?.slice(0, 4)
    }))
  };
}

export async function runOpportunityChatAgent({ workspace, opportunity, entity, signals, briefing, entityMatters, message, history = [], apiKey, provider }) {
  const ctx = compactOpportunityContext({ workspace, opportunity, entity, signals, briefing, entityMatters });
  const userPrompt = `Opportunity context (JSON):
${JSON.stringify(ctx).slice(0, 12000)}

Partner question: ${message}`;

  const messages = [
    ...history
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userPrompt }
  ];

  const { text } = await callText({
    apiKey, provider,
    model: MODELS.sonnet,
    system: OPPORTUNITY_CHAT_SYSTEM,
    messages,
    maxTokens: 1200
  });

  const citations = [];
  const refRegex = /(opp-[a-f0-9]{8,}|sig-[a-f0-9]{8,}|M-\d{4}-\d{3,})/g;
  let m;
  while ((m = refRegex.exec(text)) !== null) citations.push({ ref: m[1] });

  return { content: text, citations };
}
