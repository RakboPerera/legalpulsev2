// Expansion pass — fixes a short-fall in prospect coverage from the first
// manual rewrite. Two distinct gaps addressed:
//   (a) 4 prospects had ZERO signals because the bake's per-entity Tavily
//       cap (BAKE_GDELT_ENTITIES=10) prioritised clients in seed order,
//       starving TotalEnergies / Stellantis / Glencore / BAE.
//   (b) 4 prospects had usable signals (Anthropic, Lockheed, Ford, Toyota)
//       but the first manual rewrite skipped them — partner judgment error.
//
// This script: ingests the targeted Tavily refetch for (a), authors 9
// additional partner-quality prospect opportunities, merges everything
// back into demo-snapshot.json.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');

const snapshot = JSON.parse(fs.readFileSync(path.join(dataDir, 'demo-snapshot.json'), 'utf8'));
const summary = JSON.parse(fs.readFileSync(path.join(dataDir, 'bake-summary.json'), 'utf8'));
const newSigs = JSON.parse(fs.readFileSync(path.join(dataDir, 'tmp-prospect-fetch.json'), 'utf8'));

function id(prefix, ...parts) {
  const h = crypto.createHash('sha256').update(parts.map(p => String(p ?? '')).join('|')).digest('hex').slice(0, 16);
  return `${prefix}-${h}`;
}
const now = new Date().toISOString();

// Merge the new prospect signals into the snapshot's signal pool. Dedupe
// by id (the source-level deterministic hash). The bake's classifier
// already heuristic-flagged most as significant via keyword regex.
const existingIds = new Set(snapshot.signals.map(s => s.id));
let added = 0;
for (const sg of newSigs) {
  if (existingIds.has(sg.id)) continue;
  // The Tavily refetch didn't run through the classifier — apply a generous
  // significant=true so they're available to opportunities. The senior-
  // partner narrative below cites them directly so we're not relying on the
  // classifier flag for routing.
  sg.isLegallySignificant = true;
  sg.legalSignificanceReason = 'targeted-fetch (post-bake manual pass)';
  sg.classifiedAt = now;
  sg.classifiedBy = 'manual-expansion';
  snapshot.signals.push(sg);
  added++;
}
console.log(`[expand] merged ${added} new prospect signals into pool (total signals now ${snapshot.signals.length})`);

// === Author the 9 additional prospect opportunities. Each cites real
// signals from the (now-expanded) pool via predicate match. ===
const NEW_OPPS = [
  // ---- Previously-missed prospects with existing signals ----
  {
    title: 'Anthropic — publisher copyright suits',
    entity: 'pr-anthropic',
    suggestedService: 'commercial_litigation',
    engineSource: 'prospect_discovery',
    signalQuery: sig => sig.source === 'courtlistener' && /anthropic/i.test(sig.title||''),
    summary: 'Three federal suits filed in N.D. Cal. (Cruz, Chicken Soup for the Soul, Cognella) — publisher copyright wave on AI training data; defense + licensing-strategy mandate.',
    reasoning: 'CourtListener confirms three new N.D. California complaints against Anthropic PBC: Cruz, Chicken Soup for the Soul LLC, and Cognella Inc. (publishers). Pattern is the flagship AI training-data copyright wave; defense plus licensing-track strategy is the operative mandate. Firm\'s IP / commercial litigation bench is a credible cold-approach hook on a high-profile prospect. JPML consolidation plausible.',
    urgencyTier: 'immediate',
    confidence: 0.85,
    score: 86,
    severity: 'p0',
    triggers: ['litigation', 'ip', 'ai-governance'],
    competitiveContext: 'crowded',
    estimatedRevenue: 2500000
  },
  {
    title: 'Lockheed Martin — federal litigation watch',
    entity: 'pr-lockheed',
    suggestedService: 'commercial_litigation',
    engineSource: 'prospect_discovery',
    signalQuery: sig => sig.source === 'courtlistener' && /lockheed martin/i.test(sig.title||''),
    summary: '[Critic flagged — review needed: dockets-only, no substantive claim detail] Three federal cases against Lockheed (CA × 2, IL) — watching brief, monitor before pitching.',
    reasoning: 'Three new federal complaints (Martinez × 2 in E.D. Cal., Jeffreys in N.D. Ill.) within the recency window. Dockets only — could be employment claims, product disputes, or contract matters; PACER content not yet visible. Severity p3 / watching brief; revisit when claim detail surfaces. Defense contractor + sector hook (export controls) keeps Lockheed worth tracking as a prospect.',
    urgencyTier: 'this_week',
    confidence: 0.45,
    score: 48,
    severity: 'p3',
    triggers: ['litigation'],
    competitiveContext: 'open',
    estimatedRevenue: 200000,
    criticIssues: ['Dockets-only data; substantive claim text not yet on PACER', 'Cases may be unrelated (employment vs commercial)']
  },
  {
    title: 'Ford — product-liability litigation pattern',
    entity: 'pr-ford',
    suggestedService: 'class_actions',
    engineSource: 'prospect_discovery',
    signalQuery: sig => sig.source === 'courtlistener' && /ford motor/i.test(sig.title||''),
    summary: 'Four federal suits against Ford in four districts in recent weeks (Dosen, Malakowsky, Radaker, Song) — coordinated product-liability pattern likely; class-action defense pitch for prospect.',
    reasoning: 'CourtListener confirms four new federal complaints filed against Ford Motor Company across distinct districts (N.D. Cal., D. Colo., W.D. Ky., C.D. Cal.) within the recency window. The geographic spread and timing suggest a coordinated product-liability or consumer-protection campaign rather than unrelated individual claims. JPML coordination plausible; firm\'s product-liability defense bench is the credible cold-approach hook.',
    urgencyTier: 'this_week',
    confidence: 0.72,
    score: 74,
    severity: 'p1',
    triggers: ['litigation'],
    competitiveContext: 'moderate',
    estimatedRevenue: 1500000
  },
  {
    title: 'Toyota — TMCC consumer-finance class wave',
    entity: 'pr-toyota',
    suggestedService: 'class_actions',
    engineSource: 'prospect_discovery',
    signalQuery: sig => sig.source === 'courtlistener' && /toyota/i.test(sig.title||''),
    summary: 'Three Toyota Motor Credit Corp class-action filings (E.D.N.Y., W.D. Tex., N.D. Cal.) plus a Toyota Motor NA case — consumer-finance wave; defense + MDL strategy.',
    reasoning: 'Four recent federal complaints touching Toyota: three against Toyota Motor Credit Corp (King E.D.N.Y., Galindo W.D. Tex., Guzman Guzman N.D. Cal.) plus Cornejo v. Toyota Motor NA (C.D. Cal.). The TMCC pattern is characteristic of TILA / consumer-finance class actions; auto-finance defense is the operative service. Firm\'s consumer-class-action defense bench positioned; cold-approach hook is the pattern itself.',
    urgencyTier: 'this_week',
    confidence: 0.75,
    score: 76,
    severity: 'p1',
    triggers: ['litigation'],
    competitiveContext: 'moderate',
    estimatedRevenue: 1300000
  },
  // ---- Previously-silent prospects (Tavily-refetched) ----
  {
    title: 'TotalEnergies — Hormuz oil-trade disputes',
    entity: 'pr-total',
    suggestedService: 'force_majeure_advisory',
    engineSource: 'prospect_discovery',
    signalQuery: sig => sig.source === 'tavily' && /totalenergies/i.test(sig.title||'') && (/hormuz|oil traders.*lawyer|french politicians|supertax|war.related profit/i.test((sig.title||'')+(sig.description||''))),
    summary: "Insurance Journal flags 'billions in Hormuz oil-trade disputes'; TotalEnergies named — force-majeure clause review across crude/LNG offtake book is immediate work.",
    reasoning: "Insurance Journal (May 2026) reports oil traders 'lawyering up' over Hormuz-disruption-driven disputes worth billions; TotalEnergies is one of the named majors. Force-majeure clause activation across crude and LNG offtake contracts is the immediate work; standing Hormuz / maritime arbitration practice (Hartwell) is a credible cold-approach hook. Separately, French windfall-tax pressure (Reuters) is a parallel regulatory track worth flagging.",
    urgencyTier: 'immediate',
    confidence: 0.78,
    score: 82,
    severity: 'p1',
    triggers: ['force-majeure', 'commercial-contract'],
    competitiveContext: 'crowded',
    estimatedRevenue: 1400000
  },
  {
    title: 'TotalEnergies — US offshore-wind dispute ($1bn walk-away)',
    entity: 'pr-total',
    suggestedService: 'commercial_litigation',
    engineSource: 'prospect_discovery',
    signalQuery: sig => sig.source === 'tavily' && /totalenergies/i.test((sig.title||'')+(sig.description||'')) && /(offshore wind|1 billion|\$1b|walk.away|payoff|interior)/i.test((sig.title||'')+(sig.description||'')),
    summary: "TotalEnergies' $1bn US offshore-wind walk-away (CleanTechnica reporting) opens government-contract and securities-disclosure exposure — commercial-litigation pitch.",
    reasoning: "CleanTechnica and Interior Dept release confirm TotalEnergies received $1bn to walk away from US offshore-wind leases. Disclosure adequacy under French and US securities regimes plus follow-on contract / sub-vendor disputes are the operative risks; firm's commercial litigation and energy regulatory bench positioned. Score reflects single-source dominance (CleanTechnica is editorial).",
    urgencyTier: 'this_week',
    confidence: 0.68,
    score: 70,
    severity: 'p1',
    triggers: ['regulatory', 'commercial-contract', 'litigation'],
    competitiveContext: 'open',
    estimatedRevenue: 900000
  },
  {
    title: 'Stellantis — STLA securities class actions',
    entity: 'pr-stellantis',
    suggestedService: 'securities_litigation',
    engineSource: 'prospect_discovery',
    signalQuery: sig => sig.source === 'tavily' && /stellantis|stla/i.test(sig.title||'') && /(securities|fraud|class action|investor rights|schall|rosen)/i.test((sig.title||'')+(sig.description||'')),
    summary: 'Schall and Rosen lead multiple STLA securities-fraud class actions in late-April — Stellantis securities-defense pitch; named entity, multi-firm plaintiff side.',
    reasoning: "Schall Law Firm (May 4) and Rosen Law Firm (April 29) press releases confirm parallel STLA securities-fraud class action investigations. Lead-plaintiff motion deadlines are imminent; defense team selection happens in the next 2-3 weeks. Firm's securities-litigation bench (Vasquez) is the credible cold-approach hook on a prospect with no prior relationship. JPML consolidation likely.",
    urgencyTier: 'immediate',
    confidence: 0.82,
    score: 85,
    severity: 'p0',
    triggers: ['litigation'],
    competitiveContext: 'crowded',
    estimatedRevenue: 2200000
  },
  {
    title: 'Glencore — Kazzinc plant explosion',
    entity: 'pr-glencore',
    suggestedService: 'regulatory_defense',
    engineSource: 'prospect_discovery',
    signalQuery: sig => sig.source === 'tavily' && /glencore/i.test(sig.title||'') && /(blast|kazzinc|explosion|killed|injured|kazakhstan)/i.test((sig.title||'')+(sig.description||'')),
    summary: 'Fatal explosion at Glencore Kazzinc plant (Kazakhstan) — workplace-safety, criminal-liability and regulatory-defence work across multiple jurisdictions.',
    reasoning: "Mining.com and Bitget confirm a fatal explosion (2 dead, 5 injured) at Glencore's Kazzinc plant in eastern Kazakhstan. Workplace-safety investigation under Kazakh law, parallel exposure to UK Bribery Act / Modern Slavery scrutiny on the parent company, plus civil claims from victims' families. Multi-jurisdictional incident-response and regulatory defence is the operative mandate; firm's prior Africa / DRC commodity work positions us. Separately, Colombia coal-mine closure pressure (Reuters) is an adjacent regulatory track.",
    urgencyTier: 'immediate',
    confidence: 0.80,
    score: 84,
    severity: 'p0',
    triggers: ['regulatory', 'litigation', 'employment'],
    competitiveContext: 'open',
    estimatedRevenue: 1800000
  },
  {
    title: 'BAE Systems — £120m Kenya commercial lawsuit',
    entity: 'pr-bae',
    suggestedService: 'commercial_litigation',
    engineSource: 'prospect_discovery',
    signalQuery: sig => sig.source === 'tavily' && /bae systems/i.test(sig.title||'') && /(lawsuit|sue|kenya|encomm|£120|breach)/i.test((sig.title||'')+(sig.description||'')),
    summary: "EnComm Aviation's £120m suit against BAE over Kenya arms sales — commercial / contract dispute with reputational and export-licensing overhang.",
    reasoning: "BAE Systems faces a £120m commercial claim from Kenya-based EnComm Aviation alleging damages tied to arms-sale arrangements. Commercial-litigation defence is the immediate mandate; reputational and export-licensing risk overhangs (UK SPIRE / US ITAR depending on platform). Single-source signal (Bez Kabli reporting); worth confirming via UK High Court CE-File before pitching.",
    urgencyTier: 'this_week',
    confidence: 0.68,
    score: 70,
    severity: 'p1',
    triggers: ['litigation', 'commercial-contract', 'sanctions-trade'],
    competitiveContext: 'moderate',
    estimatedRevenue: 1100000
  }
];

// Resolve signals + build opportunity records.
const newOppRecords = [];
const rebuildLog = [];
for (const o of NEW_OPPS) {
  const matches = snapshot.signals.filter(o.signalQuery).slice(0, 5);
  if (!matches.length) {
    console.warn(`[expand] ${o.title}: no matching signals found, skipping`);
    rebuildLog.push(`[skip] ${o.title}: no matching signals`);
    continue;
  }
  const signalIds = matches.map(s => s.id);
  const oppId = id('opp', o.engineSource, o.entity, o.suggestedService, signalIds.sort().join(','));
  newOppRecords.push({
    id: oppId,
    type: 'prospect',
    engineSource: o.engineSource,
    entity: o.entity,
    entityType: 'prospect',
    suggestedService: o.suggestedService,
    urgencyTier: o.urgencyTier,
    confidence: o.confidence,
    estimatedRevenue: o.estimatedRevenue,
    competitiveContext: o.competitiveContext,
    score: o.score,
    severity: o.severity,
    triggers: o.triggers,
    generatedAt: now,
    status: 'new',
    statusHistory: [{ status: 'new', changedBy: 'manual_expand', changedAt: now }],
    notes: 'PROSPECT — review for solicitation compliance before outreach.',
    basis: {
      summary: o.summary,
      signalIds,
      matterReferences: [],
      reasoning: o.reasoning,
      ...(o.criticIssues ? { criticIssues: o.criticIssues } : {})
    }
  });
  rebuildLog.push(`[ok] ${o.title} → ${matches.length} signals linked`);
}

console.log('=== Expansion log ===');
for (const line of rebuildLog) console.log(line);

// Generate matching briefings.
function partnerBriefing(opp) {
  const entity = [...snapshot.clients, ...snapshot.prospects].find(e => e.id === opp.entity);
  const signals = (opp.basis.signalIds || []).map(sid => snapshot.signals.find(s => s.id === sid)).filter(Boolean);
  const cited = signals.slice(0, 4).map(s => ({
    source: s.source,
    url: s.sourceUrl,
    title: s.title,
    publishedAt: s.publishedAt,
    excerpt: (s.description || s.title || '').slice(0, 280)
  }));
  return {
    id: id('brf', opp.id),
    opportunityId: opp.id,
    generatedAt: now,
    basis: {
      oneLineHeadline: `${entity?.legalName || opp.entity}: ${opp.basis.summary.slice(0, 120)}`,
      detailedExplanation: opp.basis.reasoning,
      citedSources: cited
    },
    talkingPoints: [
      { angle: 'commercial', point: opp.basis.reasoning.split('. ').slice(0, 2).join('. ') + '.' },
      { angle: 'positioning', point: `No prior matter history with ${entity?.legalName} — cold approach justified by firm's expertise on this specific trigger. Pre-clear conflicts before first contact.` },
      { angle: 'competitive', point: opp.competitiveContext === 'crowded'
        ? 'Multiple firms will be on this call. Speed to in-house counsel + a specific point-of-view in the first 24h is the differentiator.'
        : opp.competitiveContext === 'open'
          ? 'No identified rival on the engagement yet — early outreach captures the mandate.'
          : 'Moderate competition expected — sharpen the firm-specific angle before pitching.' }
    ],
    urgencyTier: opp.urgencyTier,
    timingRecommendation: opp.urgencyTier === 'immediate' ? 'Partner contact within 24–48 hours while the signal is fresh.' : 'Aim for partner contact within the week.',
    confidence: opp.confidence,
    auditTrail: []
  };
}

const newBriefings = newOppRecords.map(partnerBriefing);

// Merge into snapshot.
snapshot.opportunities.push(...newOppRecords);
snapshot.briefings.push(...newBriefings);
snapshot.bakedAt = now;

// Rebuild summary counts.
const opsByEngine = {
  crossSell: snapshot.opportunities.filter(o => o.engineSource === 'cross_sell').length,
  prospects: snapshot.opportunities.filter(o => o.engineSource === 'prospect_discovery').length,
  eventDriven: snapshot.opportunities.filter(o => o.engineSource === 'event_intelligence').length
};
const newSummary = {
  ...summary,
  bakedAt: now,
  bakedBy: 'manual-llm-expand-prospects (Claude Code conversation)',
  qualityGate: {
    ...summary.qualityGate,
    passed: snapshot.opportunities.filter(o => o.severity !== 'p3').length,
    demoted: snapshot.opportunities.filter(o => o.severity === 'p3').length,
    partnerJudgedAdditions: (summary.qualityGate?.partnerJudgedAdditions || 4) + newOppRecords.length
  },
  briefingsGenerated: snapshot.briefings.length,
  opportunitiesGenerated: opsByEngine,
  signalsIngested: (summary.signalsIngested || 0) + added,
  signalsAfterDedup: snapshot.signals.length
};

fs.writeFileSync(path.join(dataDir, 'demo-snapshot.json'), JSON.stringify(snapshot, null, 2));
fs.writeFileSync(path.join(dataDir, 'bake-summary.json'), JSON.stringify(newSummary, null, 2));
console.log(`\n[expand] wrote snapshot — total opps: ${snapshot.opportunities.length} (added ${newOppRecords.length} prospect opps)`);
console.log(`[expand] prospect opps: ${opsByEngine.prospects}, event-driven: ${opsByEngine.eventDriven}, cross-sell: ${opsByEngine.crossSell}`);
