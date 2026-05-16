// Deterministic heuristics used when Anthropic API is not available, so the bake
// still produces a meaningful demo snapshot. These mirror what the agents would
// produce in spirit but are coarser.

import { opportunityId, briefingId } from '../backend/lib/ids.js';

const LEGAL_KEYWORDS = [
  'litigation', 'lawsuit', 'class action', 'settlement', 'court', 'judgment', 'sanction',
  'sanctions', 'designation', 'enforcement', 'investigation', 'antitrust', 'merger',
  'acquisition', 'm&a', 'ipo', 'tender offer', 'prosecution', 'indictment', 'plea',
  'fined', 'fine', 'penalty', 'guilty', 'regulator', 'regulatory', 'fca', 'sec',
  'ofac', 'cma', 'doj', 'ftc', 'dg comp', 'cybersecurity', 'data breach', 'restructur',
  'insolvency', 'bankruptcy', 'patent', 'trademark', 'export control', 'force majeure',
  'arbitration', 'hormuz', 'red sea', 'tariff', 'duty', 'ai act'
];

const INDUSTRY_KEYWORDS = {
  oil_gas: ['oil', 'gas', 'crude', 'lng', 'refinery', 'aramco', 'bp', 'exxon', 'totalenergies', 'shell'],
  banking: ['bank', 'jpmorgan', 'goldman', 'hsbc', 'wall street', 'lender'],
  shipping: ['shipping', 'tanker', 'vessel', 'maersk', 'container', 'cargo', 'maritime', 'hormuz', 'red sea'],
  automotive: ['automotive', 'volkswagen', 'vw', 'general motors', 'gm', 'stellantis', 'electric vehicle', 'ev recall'],
  semiconductors: ['semiconductor', 'asml', 'chip', 'lithography', 'tsmc'],
  defense_aerospace: ['boeing', 'lockheed', 'rolls-royce', 'bae', 'defence', 'defense', 'aircraft', 'aerospace'],
  pharma: ['pfizer', 'sanofi', 'pharma', 'biosimilar', 'fda', 'ema', 'vaccine'],
  telecoms: ['vodafone', 'telecom', 'mobile operator', '5g'],
  technology: ['microsoft', 'cloud', 'ai regulation', 'artificial intelligence'],
  commodities: ['glencore', 'commodities', 'mining'],
  fintech: ['wise', 'fintech', 'payments']
};

const SERVICE_FROM_SIGNAL = [
  { match: /m&a|acquisition|merger|tender offer|takeover/i, service: 'cross_border_ma', practiceArea: 'corporate_ma' },
  { match: /ipo|s-1|going public/i, service: 'public_takeovers', practiceArea: 'corporate_ma' },
  { match: /ofac|sanction|sdn list|designat/i, service: 'ofac_advisory', practiceArea: 'sanctions_trade' },
  { match: /eu sanction|consolidated list/i, service: 'eu_sanctions_advisory', practiceArea: 'sanctions_trade' },
  { match: /ofsi|uk sanction/i, service: 'uk_ofsi_advisory', practiceArea: 'sanctions_trade' },
  { match: /export control|bis license|dual-use/i, service: 'export_controls', practiceArea: 'sanctions_trade' },
  { match: /class action|product liability|recall/i, service: 'class_actions', practiceArea: 'litigation_disputes' },
  // Securities litigation must be triggered by actual litigation language —
  // routine 10-K/10-Q filings without litigation content do NOT qualify.
  { match: /securities (litigation|class action|fraud|investigation|enforcement)|sec enforcement|consent decree|restate|going concern/i, service: 'securities_litigation', practiceArea: 'litigation_disputes' },
  { match: /patent|infringement|biosimilar/i, service: 'patent_litigation', practiceArea: 'ip_technology' },
  { match: /trade secret/i, service: 'trade_secrets_litigation', practiceArea: 'ip_technology' },
  { match: /antitrust|competition|cma|dg comp|merger control/i, service: 'eu_competition', practiceArea: 'regulatory_compliance' },
  { match: /fca|consumer duty|s.166|skilled person/i, service: 'financial_services_regulation', practiceArea: 'regulatory_compliance' },
  { match: /ai act|artificial intelligence act|ai regulation/i, service: 'ai_regulation_advisory', practiceArea: 'regulatory_compliance' },
  { match: /hormuz|red sea|force majeure|charter|arbitration/i, service: 'force_majeure_advisory', practiceArea: 'litigation_disputes' },
  { match: /windfall|energy profits levy/i, service: 'windfall_tax_advisory', practiceArea: 'energy_natural_resources' },
  { match: /decommission|abandonment|plug and abandon/i, service: 'decommissioning', practiceArea: 'energy_natural_resources' },
  { match: /climate|esg|net zero|emissions/i, service: 'esg_compliance', practiceArea: 'regulatory_compliance' },
  { match: /cyber|data breach|ransomware/i, service: 'cybersecurity_advisory', practiceArea: 'ip_technology' },
  { match: /restructur|insolvency|chapter 11|administration|scheme of arrangement/i, service: 'corporate_restructuring', practiceArea: 'restructuring_insolvency' },
  { match: /fdi|national security/i, service: 'fdi_clearance', practiceArea: 'corporate_ma' },
  { match: /general counsel|chief compliance|head of legal/i, service: 'commercial_litigation', practiceArea: 'litigation_disputes' }
];

// EDGAR filings only fire as legal triggers when their text mentions an event
// type that creates actual legal need. Routine quarterly reports without these
// markers are NOT signals — they're just compliance paperwork that every
// public company files. A senior partner reading them would skip past.
const EDGAR_MATERIAL_MARKERS = /\b(litigation|lawsuit|class action|investigation|subpoena|enforcement|consent decree|settlement|material adverse|going concern|restatement|impairment|antitrust|merger|acquisition|tender|going private|bankruptcy|chapter 11|cyber|data breach|recall|product liability|patent infringement|fraud|whistleblower)\b/i;

// CourtListener: a court case in our system is interesting only if it mentions
// the entity by name (handled by the linker) AND the case looks substantive.
// Routine bankruptcies of unrelated parties shouldn't trigger opportunities.
const COURTLISTENER_MATERIAL_MARKERS = /\b(class action|securities|antitrust|merger|injunction|patent|trade secret|securities fraud|False Claims Act|RICO|sanctions|export control|investigation)\b/i;

// FCA RSS — most posts are routine consultations or guidance. Only fire on
// concrete enforcement / fines / actions.
const FCA_MATERIAL_MARKERS = /\b(fine|penalty|enforcement|warning notice|prohibition order|s\.166|skilled person|ban|suspension|investigation)\b/i;

export function classifySignalHeuristic(signal) {
  const text = `${signal.title || ''} ${signal.description || ''}`.toLowerCase();
  const hits = LEGAL_KEYWORDS.filter(k => text.includes(k));

  // Source-specific significance gates. The previous logic treated every
  // signal from EDGAR/CourtListener/etc. as significant by virtue of the
  // source — which produced ~50% noise. A senior partner cares about
  // CONTENT, not source.
  let isLegallySignificant;
  let reason;
  if (signal.source === 'edgar') {
    if (EDGAR_MATERIAL_MARKERS.test(text)) {
      isLegallySignificant = true;
      reason = 'EDGAR filing contains material legal markers.';
    } else {
      isLegallySignificant = false;
      reason = 'Routine SEC filing without litigation/material-event markers.';
    }
  } else if (signal.source === 'courtlistener') {
    isLegallySignificant = COURTLISTENER_MATERIAL_MARKERS.test(text) || hits.length > 0;
    reason = isLegallySignificant
      ? 'Court case with substantive legal markers.'
      : 'Court case without substantive litigation markers.';
  } else if (signal.source === 'fca') {
    isLegallySignificant = FCA_MATERIAL_MARKERS.test(text);
    reason = isLegallySignificant
      ? 'FCA enforcement / fine / action.'
      : 'FCA routine post (consultation, guidance, market commentary).';
  } else if (['ofac_sdn', 'eu_sanctions', 'uk_ofsi'].includes(signal.source)) {
    // After the sanctions matcher fix, signals in these sources represent
    // genuine token-exact matches and ARE significant.
    isLegallySignificant = true;
    reason = 'Sanctions list match.';
  } else {
    // GDELT, RSS — keyword-driven significance.
    isLegallySignificant = hits.length > 0;
    reason = isLegallySignificant
      ? `Detected ${hits.slice(0, 3).join(', ')}.`
      : 'No legal keywords detected.';
  }

  const affectedIndustries = [];
  for (const [ind, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
    if (keywords.some(k => text.includes(k))) affectedIndustries.push(ind);
  }

  return {
    isLegallySignificant,
    reason,
    affectedIndustries,
    candidatePracticeAreas: deriveCandidatePracticeAreas(text),
    eventTopic: deriveEventTopic(text)
  };
}

function deriveCandidatePracticeAreas(text) {
  const out = new Set();
  for (const rule of SERVICE_FROM_SIGNAL) {
    if (rule.match.test(text)) out.add(rule.practiceArea);
  }
  return Array.from(out);
}

function deriveEventTopic(text) {
  for (const rule of SERVICE_FROM_SIGNAL) {
    if (rule.match.test(text)) return rule.service.replace(/_/g, ' ');
  }
  return 'general event';
}

export function pickServiceFromSignal(signal) {
  const text = `${signal.title || ''} ${signal.description || ''}`.toLowerCase();
  for (const rule of SERVICE_FROM_SIGNAL) {
    if (rule.match.test(text)) return { service: rule.service, practiceArea: rule.practiceArea };
  }
  return null;
}

export function buildHeuristicBriefing(opportunity, entity, signals, matters) {
  const headlineSignal = signals[0];
  const citedSources = signals.slice(0, 4).map(s => ({
    source: s.source,
    url: s.sourceUrl,
    title: s.title,
    publishedAt: s.publishedAt,
    excerpt: (s.description || s.title || '').slice(0, 240)
  }));
  const relevantMatters = (matters || []).filter(m => m.client === entity.id).slice(0, 3);

  const headline = headlineSignal
    ? `${entity.legalName}: ${headlineSignal.title.slice(0, 90)}`
    : `${entity.legalName}: ${opportunity.suggestedService.replace(/_/g, ' ')} opportunity`;

  // Pull richer text from the signal — prefer description over title since
  // descriptions often contain factual context the LLM brief would otherwise
  // generate. Fall back to opportunity reasoning, then summary.
  const sigContext = headlineSignal
    ? `Per ${headlineSignal.source.toUpperCase()} (${headlineSignal.publishedAt?.slice(0,10)}): "${(headlineSignal.description || headlineSignal.title || '').slice(0, 240)}"`
    : '';
  const reasoningText = opportunity.basis?.reasoning || opportunity.basis?.summary || '';
  const explanation = sigContext
    ? `${sigContext}. ${reasoningText}`
    : reasoningText;

  const talkingPoints = [
    {
      angle: 'commercial',
      point: `Targeted offer: ${opportunity.suggestedService.replace(/_/g, ' ')}. ${entity.legalName} is exposed via current ${opportunity.engineSource === 'event_intelligence' ? 'event signals' : 'sector positioning'}.`
    },
    {
      angle: 'regulatory',
      point: relevantMatters.length
        ? `Builds on prior work for ${entity.legalName} (e.g., ${relevantMatters[0].id} — ${relevantMatters[0].matterTitle}).`
        : `Comparable matters in this cluster have been led by the firm previously.`
    },
    {
      angle: 'reputational',
      point: `Engaging early protects the relationship and pre-empts competitor outreach on the same event flow.`
    }
  ];

  return {
    id: briefingId(opportunity.id),
    opportunityId: opportunity.id,
    generatedAt: new Date().toISOString(),
    basis: {
      oneLineHeadline: headline,
      detailedExplanation: explanation.slice(0, 700),
      citedSources
    },
    talkingPoints,
    urgencyTier: opportunity.urgencyTier,
    timingRecommendation: opportunity.urgencyTier === 'immediate'
      ? 'Contact within 24-48 hours while the signal is fresh.'
      : opportunity.urgencyTier === 'this_week'
      ? 'Aim for partner contact within the week.'
      : 'Add to steady-state outreach plan for the next quarterly cycle.',
    confidence: opportunity.confidence,
    auditTrail: []
  };
}

// Heuristic mapping from eventTopic (per-signal) → opportunity-level trigger
// taxonomy. Lifted from anthropics/claude-for-legal launch-radar cookbook
// pattern: opportunities carry 1-3 risk-domain triggers SEPARATE from the
// service to pitch, so the UI can filter the pipeline by risk domain.
const TOPIC_TO_TRIGGER = {
  'litigation general': 'litigation', 'securities litigation': 'litigation',
  'class actions': 'litigation', 'product liability': 'litigation',
  'patent litigation': 'ip', 'trade secrets': 'ip',
  'm and a': 'm-and-a', 'fdi screening': 'm-and-a',
  'merger control': 'competition-antitrust',
  'ofac sanctions': 'sanctions-trade', 'eu uk sanctions': 'sanctions-trade',
  'export controls': 'sanctions-trade',
  'regulatory enforcement': 'regulatory', 'regulatory rulemaking': 'regulatory',
  'ai regulation': 'ai-governance',
  'esg climate': 'esg-climate', 'decommissioning': 'esg-climate',
  'cyber data': 'cyber-security',
  'restructuring': 'restructuring', 'finance lending': 'restructuring',
  'force majeure': 'force-majeure',
  'employment executive': 'employment'
};

function inferTriggerFromService(service) {
  const s = (service || '').toLowerCase();
  if (s.includes('litigation') || s.includes('dispute')) return 'litigation';
  if (s.includes('m_a') || s.includes('m&a') || s.includes('merger')) return 'm-and-a';
  if (s.includes('sanction') || s.includes('export_control')) return 'sanctions-trade';
  if (s.includes('privacy') || s.includes('data_protection') || s.includes('gdpr')) return 'privacy-data';
  if (s.includes('ai_') || s.includes('artificial')) return 'ai-governance';
  if (s.includes('patent') || s.includes('trademark') || s.includes('ip_')) return 'ip';
  if (s.includes('cyber') || s.includes('security')) return 'cyber-security';
  if (s.includes('employ') || s.includes('labour') || s.includes('labor')) return 'employment';
  if (s.includes('restructur') || s.includes('insolven')) return 'restructuring';
  if (s.includes('esg') || s.includes('climate')) return 'esg-climate';
  if (s.includes('antitrust') || s.includes('competition')) return 'competition-antitrust';
  if (s.includes('commercial') || s.includes('contract')) return 'commercial-contract';
  return 'regulatory';
}

// Content-based trigger matching, used in addition to eventTopic. The
// eventTopic taxonomy is per-signal and sometimes coarse ("general",
// "regulatory_enforcement"); reading the title/description directly recovers
// nuance like force-majeure or sector-specific risk.
const CONTENT_TO_TRIGGER = [
  [/hormuz|red sea|suez|force majeure|vessel diver|tanker|charter party/i, 'force-majeure'],
  [/data breach|cyber attack|ransomware|hack|security incident/i, 'cyber-security'],
  [/gdpr|ccpa|dsar|data protection|privacy law/i, 'privacy-data'],
  [/\bai act\b|artificial intelligence reg|generative ai|model governance/i, 'ai-governance'],
  [/sanction|\bofac\b|\bsdn\b|export control|consolidated list/i, 'sanctions-trade'],
  [/\bmerger\b|acquisition|takeover|tender offer|divestiture|hostile bid/i, 'm-and-a'],
  [/patent|trademark|trade secret|copyright|infringement/i, 'ip'],
  [/class action|securities litigation|product liability|recall|consumer protection/i, 'litigation'],
  [/lawsuit filed|complaint filed|injunction|consent decree|court ruling/i, 'litigation'],
  [/breach of contract|msa dispute|supply chain dispute/i, 'commercial-contract'],
  [/wrongful termination|gc resign|cco appoint|workforce dispute|labour dispute/i, 'employment'],
  [/insolvency|chapter 11|administration filing|restructur|scheme of arrange/i, 'restructuring'],
  [/climate litigation|emissions disclosure|esg disclosure|decommission/i, 'esg-climate'],
  [/antitrust|merger control|cartel|abuse of dominance|dg comp/i, 'competition-antitrust']
];

export function deriveTriggers(signals, service) {
  const out = new Set();
  for (const s of (signals || [])) {
    const mapped = TOPIC_TO_TRIGGER[(s.eventTopic || '').toLowerCase()];
    if (mapped) out.add(mapped);
    const text = `${s.title || ''} ${s.description || ''}`;
    for (const [pattern, trigger] of CONTENT_TO_TRIGGER) {
      if (pattern.test(text)) out.add(trigger);
    }
  }
  if (out.size === 0) out.add(inferTriggerFromService(service));
  return [...out].slice(0, 3);
}

export function deriveSeverity(urgencyTier, signals) {
  // p0 = bet-the-company, p1 = material, p2 = standard, p3 = watching brief.
  // Calibration target: p0 5-10%, p1 25-30%, p2 50-60%, p3 10-15%.
  // Severity is read from signal CONTENT — urgency is a separate dimension
  // and does NOT promote severity by itself.
  const text = (signals || []).map(s => `${s.title} ${s.description || ''}`).join(' ');
  // p0 — bet-the-company language (rare)
  if (/criminal indictment|criminal charges|stop order|licen[cs]e revoc|going concern|chapter 11|systemic risk|multi[- ]billion|class action certified|cartel investigation|asset freeze|expropriation/i.test(text)) return 'p0';
  // p1 — material exposure language
  if (/consent decree|enforcement action|class action filed|securities litigation|hostile bid|merger control|data breach|sanctions designation|insider trading|\bofac\b|hormuz|red sea|force majeure|injunction|major fine|antitrust|cartel|investigation announced/i.test(text)) return 'p1';
  // p3 — structural / monitoring (no concrete event)
  if (urgencyTier === 'steady_state' && !/filed|announced|disclosed|imposed/i.test(text)) return 'p3';
  // p2 — DEFAULT for everything else
  return 'p2';
}

export function buildOpportunityHeuristic({ entity, signals, service, engineSource, matters }) {
  const urgent = signals.some(s => /immediate|today|emergency|breach|enforcement|injunction|breakout|hormuz|red sea/i.test(`${s.title} ${s.description || ''}`));
  const thisWeek = signals.some(s => /filed|announced|deadline|notice/i.test(`${s.title} ${s.description || ''}`));
  const urgencyTier = urgent ? 'immediate' : thisWeek ? 'this_week' : 'steady_state';
  const confidence = Math.min(0.4 + (signals.length * 0.1), 0.85);
  const id = opportunityId(engineSource, entity.id, service, signals.map(s => s.id));
  return {
    id,
    type: engineSource === 'cross_sell' ? 'cross_sell' : engineSource === 'prospect_discovery' ? 'prospect' : 'event_driven',
    engineSource,
    entity: entity.id,
    entityType: entity.id.startsWith('pr-') ? 'prospect' : 'client',
    suggestedService: service,
    urgencyTier,
    confidence,
    estimatedRevenue: null,
    competitiveContext: 'moderate',
    score: Math.round(40 + confidence * 50 + (urgencyTier === 'immediate' ? 10 : urgencyTier === 'this_week' ? 5 : 0)),
    triggers: deriveTriggers(signals, service),
    severity: deriveSeverity(urgencyTier, signals),
    generatedAt: new Date().toISOString(),
    status: 'new',
    statusHistory: [{ status: 'new', changedBy: 'bake', changedAt: new Date().toISOString() }],
    notes: '',
    basis: {
      summary: signals[0]
        ? `${service.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} likely required for ${entity.legalName} following recent activity: "${signals[0].title.slice(0, 100)}".`
        : `${entity.legalName} is a strong fit for ${service.replace(/_/g, ' ')} based on sector positioning.`,
      signalIds: signals.map(s => s.id),
      matterReferences: (matters || []).filter(m => m.client === entity.id).slice(0, 3).map(m => m.id),
      reasoning: signals[0]
        ? `${signals[0].source.toUpperCase()} signal "${(signals[0].description || signals[0].title || '').slice(0, 160)}" indicates ${service.replace(/_/g, ' ')} exposure for ${entity.legalName}.`
        : `${entity.legalName}'s sector profile and prior matter pattern align with ${service.replace(/_/g, ' ')}.`
    }
  };
}
