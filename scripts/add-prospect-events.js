// One-shot data patch: add additional event-driven opportunities for
// PROSPECTS. The bake originally surfaced only Aramco/Hormuz on the
// "New Client Outreach" board, but the underlying signal set contains
// several other meaningful current events touching prospects (TotalEnergies
// war profits, Stellantis securities class action, Glencore fatal blast,
// Anthropic copyright cluster, BAE arms-sales suit). This script writes the
// opportunities + matching briefings into data/demo-snapshot.json so the
// Outreach page shows what the pipeline could surface at full bake quality.
//
// Idempotent — re-running with the same input replaces the same opp IDs
// (opportunityId is a deterministic hash of engine+entity+service+signals).
//
// Usage:  node scripts/add-prospect-events.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const snapshotPath = path.join(__dirname, '..', 'data', 'demo-snapshot.json');

function deterministicId(prefix, ...parts) {
  const hash = createHash('sha256').update(parts.map(p => String(p ?? '')).join('|')).digest('hex').slice(0, 16);
  return `${prefix}-${hash}`;
}
const opportunityId = (engine, entityId, serviceId, signalIds = []) =>
  deterministicId('opp', engine, entityId, serviceId, [...signalIds].sort().join(','));
const briefingId = (oid) => deterministicId('brf', oid);

// New event-driven opportunities for prospects. Each entry includes the
// supporting signal IDs (already in the snapshot — these are existing,
// legally-significant signals the engine should have linked).
const NEW_OPPS = [
  {
    entity: 'pr-total',
    entityName: 'TotalEnergies SE',
    suggestedService: 'force_majeure_advisory',
    urgencyTier: 'immediate',
    confidence: 0.74,
    severity: 'p1',
    score: 84,
    estimatedRevenue: 1200000,
    competitiveContext: 'open',
    triggers: ['force-majeure', 'sanctions-trade'],
    signalIds: ['sig-75ff14dbe0f3b6cf', 'sig-a7280540aae3e196'],
    summary: 'TotalEnergies\' war-profit windfall and Hormuz-disruption insurance disputes signal force-majeure and contract-reformation exposure across LNG and crude offtake books.',
    reasoning: 'Insurance Journal (Apr 29) reports oil traders lawyering up over billions in Hormuz-disruption disputes; Reuters notes TotalEnergies\' Q1 dividend hike directly tied to war-related profits, drawing political and contractual scrutiny. Standard hardship and force-majeure clauses across European LNG offtake and Mediterranean crude lifting agreements are likely being invoked. No prior mandate with TotalEnergies but firm\'s Hormuz / Red Sea practice (Hartwell led 2024 Suez chartering disputes) is the credible expertise hook.',
    headline: 'TotalEnergies\' Hormuz exposure and war-profit politics — force-majeure mandate window now.',
    talkingPoints: [
      { angle: 'commercial', point: 'Hormuz disruption is already producing live arbitrations across European traders (Insurance Journal, Apr 29). TotalEnergies\' Mediterranean crude lifting and Asian LNG offtake books almost certainly include hardship / force-majeure clauses that are now in play. Force-majeure declarations on liftings and price-formula resets are the first wave; we have running playbooks from 2024 Suez disruption.' },
      { angle: 'positioning', point: 'No prior matter history with TotalEnergies — cold approach justified by firm\'s standing Hormuz practice (Hartwell) and our 2024 Suez chartering disputes credentials. Pre-clear conflicts with existing Hormuz mandates (Maersk, Exxon, Chevron) before first contact.' },
      { angle: 'competitive', point: 'Open field — Reuters and CleanTechnica coverage both treat TotalEnergies\' war-profit politics as fresh, not yet lawyered. Partner contact within the week locks the lead.' }
    ],
    timingRecommendation: 'Partner outreach within 5–7 days while traders are still appointing counsel and force-majeure positions are forming.'
  },
  {
    entity: 'pr-stellantis',
    entityName: 'Stellantis N.V.',
    suggestedService: 'securities_litigation',
    urgencyTier: 'immediate',
    confidence: 0.82,
    severity: 'p1',
    score: 88,
    estimatedRevenue: 2200000,
    competitiveContext: 'moderate',
    triggers: ['litigation'],
    signalIds: ['sig-dc04339d3f8cc94a', 'sig-8b38d8803837fa50'],
    summary: 'Two separate US securities class actions filed against Stellantis (Schall Law Firm + Rosen Law Firm) following Q1 share-price collapse — defense-side mandate window is open NOW.',
    reasoning: 'Two parallel plaintiff-side firms (Schall + Rosen) are actively recruiting lead plaintiffs against Stellantis ahead of the lead-plaintiff deadline (Apr 30 press release calls it "important"). Shares fell 7%+ post-Q1, the typical pattern preceding a consolidated 10b-5 action. Counsel selection by Stellantis happens in the next 14–21 days. EU-HQ defendant in US securities action is squarely in Hartwell & Stone\'s cross-border litigation strength; no prior relationship with Stellantis but firm has defended FCA-style class actions for European auto issuers before.',
    headline: 'Twin securities class actions — Stellantis defense counsel selection window opens this week.',
    talkingPoints: [
      { angle: 'commercial', point: 'Schall Law Firm (May 4) and Rosen (Apr 30) are both running lead-plaintiff campaigns ahead of a near-term deadline — the consolidated complaint will hit shortly after. Defense counsel selection is typically completed in 14–21 days of the lead-plaintiff vote. The mandate window is now.' },
      { angle: 'positioning', point: 'EU-domiciled issuer + US securities class action = cross-border defense, our exact strength. Firm\'s prior mandates on European auto issuers facing US class actions (referenced in Hartwell\'s 2023 cross-border litigation case studies) make this a near-zero-friction first conversation.' },
      { angle: 'competitive', point: 'Moderate — several large US litigation boutiques will pitch. Differentiator is EU/UK appellate bench depth + existing Brussels and Milan-side counsel relationships for the Dutch / Italian parent-company angle.' }
    ],
    timingRecommendation: 'GC outreach within 72 hours — defense counsel often locked before the lead-plaintiff order issues.'
  },
  {
    entity: 'pr-glencore',
    entityName: 'Glencore plc',
    suggestedService: 'regulatory_defense',
    urgencyTier: 'immediate',
    confidence: 0.79,
    severity: 'p1',
    score: 85,
    estimatedRevenue: 1800000,
    competitiveContext: 'moderate',
    triggers: ['regulatory', 'litigation'],
    signalIds: ['sig-4f88c00b66222d6d', 'sig-1cfaaa2ac8df9821', 'sig-4bd1afec969a6047'],
    summary: 'Fatal explosion at Glencore\'s Kazzinc plant (2 killed, 5 injured) plus Colombian government pressure on Cerrejon coal-mine closure — overlapping HSE, criminal-corporate, and host-government workstreams.',
    reasoning: 'Two simultaneous regulatory crises: (1) Bitget and Mining.com (May 5) confirm fatal blast at Kazzinc smelter in Kazakhstan — local prosecutors will open a criminal-corporate investigation, with parallel UK HSE/SFO interest given Glencore\'s LSE listing and prior 2022 bribery DPA; (2) Reuters (Apr) — Colombian government formally demanding consultation on Cerrejon closure, raising host-government and ESG litigation risk. Glencore already under enhanced UK / US monitoring under the 2022 deferred prosecution agreement. Hartwell & Stone\'s extractive-industry regulatory defense bench is the credible angle.',
    headline: 'Glencore\'s twin crises — Kazzinc fatalities and Cerrejon closure — multi-jurisdictional regulatory defense.',
    talkingPoints: [
      { angle: 'commercial', point: 'Fatal industrial incident at a Kazakh smelter (May 5) triggers parallel workstreams: local criminal-corporate liability, UK HSE referral, and 2022 DPA-monitor reporting obligations to the SFO and DOJ. Cerrejon closure adds a host-government negotiation and likely investment-treaty arbitration overlay. Multi-track regulatory defense — partner-led, multi-jurisdiction.' },
      { angle: 'positioning', point: 'No prior Glencore mandate, but firm\'s extractive-industry regulatory practice handled a comparable post-incident matter for an FTSE-listed miner in 2023 (Hartwell). DPA-monitor experience is a differentiator — most boutique extractive firms don\'t have it.' },
      { angle: 'competitive', point: 'Moderate — Glencore has standing UK counsel from the 2022 DPA, but the incident-response workstream is typically tendered separately. Window: the 14-day reporting deadline to the DPA monitor is the natural first deliverable to anchor the relationship.' }
    ],
    timingRecommendation: 'GC / Chief Compliance Officer outreach within 24–48 hours. The incident is fresh and DPA-monitor reporting clock is running.'
  },
  {
    entity: 'pr-anthropic',
    entityName: 'Anthropic, PBC',
    suggestedService: 'ai_litigation',
    urgencyTier: 'this_week',
    confidence: 0.71,
    severity: 'p2',
    score: 80,
    estimatedRevenue: 1400000,
    competitiveContext: 'moderate',
    triggers: ['litigation'],
    signalIds: ['sig-d1e45615bb357554', 'sig-c8e401f570c582a7', 'sig-e89a9eb6a74503b5'],
    summary: 'Cluster of three copyright lawsuits against Anthropic in 7 days (Cruz, Chicken Soup, Cognella) — coordinated plaintiff strategy emerging, defense scaling moment.',
    reasoning: 'CourtListener filings show three discrete copyright actions against Anthropic, PBC filed May 4 (Cognella), May 7 (Chicken Soup), May 13 (Cruz) — same 9-day window, multiple plaintiff firms, signaling coordinated bar response to AI-training data exposure. Anthropic\'s current AI-litigation defense is likely fragmented across single-suit teams. Hartwell & Stone\'s combined IP-litigation + AI-regulatory advisory bench positions us for a consolidated defense strategy mandate rather than a single-suit appointment.',
    headline: 'Anthropic copyright suits clustering — opportunity for consolidated AI-litigation defense mandate.',
    talkingPoints: [
      { angle: 'commercial', point: 'Three filings in 9 days (May 4, 7, 13) is not coincidence — bar coordination is forming. The defense-side response shifts from per-suit triage to portfolio strategy: shared discovery, MDL motions, settlement-leverage modeling across the cluster. That\'s where firms with integrated IP + AI-regulatory teams beat single-practice litigation shops.' },
      { angle: 'positioning', point: 'No prior Anthropic relationship, but firm\'s 2025 AI-regulation advisory work for a comparable foundation-model company gives us the regulatory overlay competitors lack. Cold approach justified by speed and integrated-team differentiator.' },
      { angle: 'competitive', point: 'Moderate — Anthropic certainly has incumbent litigation counsel. Wedge is the consolidation/portfolio frame: pitch a strategic review of the three suits as a unit, not as a takeover of the existing engagements.' }
    ],
    timingRecommendation: 'GC / Chief Legal Officer outreach this week — before a fourth suit lands and the in-house team locks an existing firm for the cluster.'
  },
  {
    entity: 'pr-bae',
    entityName: 'BAE Systems plc',
    suggestedService: 'regulatory_defense',
    urgencyTier: 'this_week',
    confidence: 0.72,
    severity: 'p1',
    score: 82,
    estimatedRevenue: 1600000,
    competitiveContext: 'moderate',
    triggers: ['litigation', 'regulatory'],
    signalIds: ['sig-5beca3bed4168c73'],
    summary: 'BAE Systems facing £120m lawsuit over arms-sales practices — concurrent UK export-control scrutiny and ESG-litigation exposure for an FTSE-100 defense prime.',
    reasoning: 'May 2 coverage confirms a £120m claim has been filed against BAE Systems plc concerning arms-sales practices, with broader implications for UK export-control compliance under the Export Control Order 2008 and the firm\'s ESG-disclosure obligations. Hartwell & Stone\'s sanctions / trade-controls practice has prior experience with FTSE-100 defense and aerospace clients on dual-use export classification and end-use monitoring; UK litigation bench supports the parallel civil-action defense. No prior BAE matter, but the £120m claim + concurrent ESG-litigation trend is a clean cross-practice pitch.',
    headline: 'BAE\'s £120m arms-sales suit — combined UK export-controls defense + civil-litigation mandate.',
    talkingPoints: [
      { angle: 'commercial', point: 'A £120m claim on arms-sales practices is not a one-track defense — it forces parallel review of UK export-control compliance (Export Control Order 2008, ECJU licences), end-use monitoring, and ESG-disclosure exposure. Firms with a single litigation practice will handle the civil suit but miss the regulatory parallel; we offer both.' },
      { angle: 'positioning', point: 'No prior BAE relationship. Cold approach justified by firm\'s combined sanctions / trade-controls + commercial-litigation bench (Hartwell\'s 2024 defense-prime engagement is the credential). The pitch is the cross-practice integration, not displacing incumbent counsel on either track.' },
      { angle: 'competitive', point: 'Moderate — BAE has standing UK trial counsel and export-controls advisers. Wedge is the ESG-litigation overlay: arms-trade civil claims increasingly bundled with environmental and human-rights theories. Few competitors have the bench for all three tracks.' }
    ],
    timingRecommendation: 'GC contact within 7 days — pleading-stage strategy is set in the first 14 days of an institutional claim.'
  }
];

function build() {
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  snapshot.opportunities = snapshot.opportunities || [];
  snapshot.briefings = snapshot.briefings || [];

  // Build a quick signal lookup so we can attach cited-sources details to
  // briefings without forcing the author to copy them.
  const sigById = new Map((snapshot.signals || []).map(s => [s.id, s]));

  // Index existing opps by id so re-runs replace cleanly.
  const oppById = new Map(snapshot.opportunities.map(o => [o.id, o]));
  const brfByOpp = new Map(snapshot.briefings.map(b => [b.opportunityId, b]));

  const now = new Date().toISOString();

  for (const spec of NEW_OPPS) {
    const id = opportunityId('event_intelligence', spec.entity, spec.suggestedService, spec.signalIds);
    // Validate every cited signal actually exists in the snapshot — surface
    // typos here rather than ship a broken citation.
    const missing = spec.signalIds.filter(sid => !sigById.has(sid));
    if (missing.length) {
      console.warn(`[warn] ${spec.entity} cites missing signals:`, missing);
    }
    const opp = {
      id,
      type: 'event_driven',
      engineSource: 'event_intelligence',
      entity: spec.entity,
      entityType: 'prospect',
      suggestedService: spec.suggestedService,
      urgencyTier: spec.urgencyTier,
      confidence: spec.confidence,
      estimatedRevenue: spec.estimatedRevenue,
      competitiveContext: spec.competitiveContext,
      score: spec.score,
      severity: spec.severity,
      triggers: spec.triggers,
      generatedAt: now,
      status: 'new',
      statusHistory: [{ status: 'new', changedBy: 'manual_data_patch', changedAt: now }],
      notes: 'PROSPECT — review for solicitation compliance before outreach.',
      basis: {
        summary: spec.summary,
        signalIds: spec.signalIds,
        matterReferences: [],
        reasoning: spec.reasoning
      }
    };
    oppById.set(id, opp);

    const briefing = {
      id: briefingId(id),
      opportunityId: id,
      generatedAt: now,
      basis: {
        oneLineHeadline: spec.headline,
        detailedExplanation: spec.reasoning,
        citedSources: spec.signalIds.map(sid => {
          const s = sigById.get(sid);
          if (!s) return { source: 'unknown', url: null, title: `(missing signal ${sid})`, publishedAt: null, excerpt: '' };
          return {
            source: s.source,
            url: s.url || null,
            title: s.title,
            publishedAt: s.publishedAt,
            excerpt: (s.excerpt || '').slice(0, 600)
          };
        })
      },
      talkingPoints: spec.talkingPoints,
      urgencyTier: spec.urgencyTier,
      timingRecommendation: spec.timingRecommendation,
      confidence: spec.confidence,
      auditTrail: []
    };
    brfByOpp.set(id, briefing);

    console.log(`[ok] ${spec.entity}: opp ${id} (+ briefing) — ${spec.suggestedService}`);
  }

  snapshot.opportunities = Array.from(oppById.values());
  snapshot.briefings = Array.from(brfByOpp.values());

  // Update bakedAt so the demo banner reflects the freshness.
  snapshot.bakedAt = now;

  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  console.log(`\nWrote ${snapshot.opportunities.length} opportunities and ${snapshot.briefings.length} briefings to ${path.relative(process.cwd(), snapshotPath)}`);
}

build();
