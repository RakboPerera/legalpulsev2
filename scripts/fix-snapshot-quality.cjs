// One-shot demo-snapshot quality pass. Idempotent. Run after a bake.
//   node scripts/fix-snapshot-quality.js
//
// Handles:
//   #3 detemplate repeated relationship/competitive talking points
//   #4 strip "[Critic flagged — …]" prefixes from briefing/opp text
//   #5 prefix bare /docket /opinion URLs with the CourtListener host
//   #6 scrub fabricated firm credentials (Red Sea, DRC, defence-prime)
//   #8 rewrite the truncated `oneLineHeadline` fields
//   #9 remove Anthropic as a prospect (and its opps / briefings / signals)

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SNAP = path.join(ROOT, 'data/demo-snapshot.json');
const SEED_PROSPECTS = path.join(ROOT, 'data/seed/prospects.json');

const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
const seedProspects = JSON.parse(fs.readFileSync(SEED_PROSPECTS, 'utf8'));

const stats = {
  criticStripped: 0,
  urlsFixed: 0,
  headlinesRewritten: 0,
  credentialsScrubbed: 0,
  relPointsRewritten: 0,
  compPointsRewritten: 0,
  anthropicOppsRemoved: 0,
  anthropicBriefingsRemoved: 0,
  anthropicSignalsRemoved: 0
};

// ---------- #4: critic prefix ----------
const CRITIC_RE = /\s*\[Critic flagged[^\]]*\]\s*/gi;
function stripCritic(s) {
  if (typeof s !== 'string') return s;
  const out = s.replace(CRITIC_RE, ' ').replace(/\s{2,}/g, ' ').trim();
  if (out !== s) stats.criticStripped++;
  return out;
}

// ---------- #5: CourtListener URL host ----------
function fixCourtListenerUrl(u) {
  if (typeof u !== 'string') return u;
  if (/^\/(docket|opinion|audio|r\/pacer|recap)\b/.test(u)) {
    stats.urlsFixed++;
    return 'https://www.courtlistener.com' + u;
  }
  return u;
}

// ---------- #6: scrub fabricated firm credentials ----------
const CREDENTIAL_REPLACEMENTS = [
  // Maersk / Red Sea — drop the fabricated "2024 Red Sea mandate" entirely
  [/,?\s*building directly on the firm['’]s 2024 Red Sea mandate\.?/gi, '.'],
  [/firm['’]s 2024 Red Sea mandate/gi, "firm’s cross-border shipping practice"],
  [/2024 Red Sea mandate/gi, "the firm’s cross-border shipping practice"],
  // Aramco / Total — "firm's standing Hormuz / Red Sea practice (Hartwell)" fabrication
  [/firm['’]s\s+(?:standing\s+)?Hormuz\s*\/\s*Red Sea practice\s*\(Hartwell(?:\s+led\s+2024\s+Suez\s+chartering\s+disputes)?\)/gi,
    "firm’s cross-border shipping bench"],
  [/firm['’]s\s+Hormuz\s*\/\s*Red Sea practice/gi, "firm’s cross-border shipping bench"],
  [/Hartwell\s+led\s+2024\s+Suez\s+chartering\s+disputes/gi, "the firm’s cross-border shipping bench"],
  // Glencore / DRC fabrications
  [/firm['’]s prior Africa\s*\/\s*DRC commodity work/gi, "firm’s commodity-sector regulatory bench"],
  [/comparable post-incident matter for an FTSE-listed miner in 2023/gi, "comparable post-incident regulatory engagements"],
  // BAE / defence-prime fabrication
  [/Hartwell['’]?s? 2024 defen[cs]e[- ]prime engagement/gi, "the firm’s defence-sector regulatory bench"],
  [/firm['’]s 2024 defen[cs]e[- ]prime engagement/gi, "the firm’s defence-sector regulatory bench"],
  // Stellantis manual-rewrite residue: invented case studies + named city counsel.
  [/\s*\(referenced in Hartwell['’]s 2023 cross-border litigation case studies\)/gi, ''],
  [/Hartwell['’]s 2023 cross-border litigation case studies/gi, "the firm’s cross-border defence bench"],
  [/firm['’]s prior mandates on European auto issuers facing US class actions/gi, "the firm’s cross-border securities-defence bench on EU-domiciled issuers"],
  [/existing Brussels and Milan-side counsel relationships for the Dutch \/ Italian parent-company angle/gi,
    "cross-jurisdiction co-counsel arrangements for the Dutch / Italian parent-company angle"],
  [/Brussels and Milan-side counsel relationships/gi, "cross-jurisdiction co-counsel arrangements"]
];
function scrubCredentials(s) {
  if (typeof s !== 'string') return s;
  let out = s;
  for (const [re, rep] of CREDENTIAL_REPLACEMENTS) {
    const before = out;
    out = out.replace(re, rep);
    if (out !== before) stats.credentialsScrubbed++;
  }
  return out;
}

// ---------- #8: rewritten headlines, keyed by brief id ----------
const HEADLINES = {
  'brf-854d5556e4916d25': "A.P. Moller-Maersk A/S: Maersk’s Hormuz transits under US naval escort activate force-majeure provisions across charter contracts.",
  'brf-bcf691bf7caad430': "Saudi Arabian Oil Company: Aramco’s Q1 export rerouting away from Hormuz creates immediate force-majeure exposure across shipping contracts.",
  'brf-401143f4f8520fc2': "Microsoft Corporation: UK CMA opens formal antitrust probe into Microsoft’s business-software dominance — a concrete UK competition mandate.",
  'brf-d8115caccba363e1': "Exxon Mobil Corporation: Exxon CEO publicly cited Hormuz disruption as an oil-price driver — operational exposure across tanker contracts.",
  'brf-867813b8e0f5c52f': "Saudi Arabian Oil Company: Aramco’s documented bypass of US-enforced Hormuz blockade triggers OFAC counterparty-screening review.",
  'brf-826ad73c16e5da1a': "Vodafone Group plc: Vodafone’s £4.3bn buyout of CK Hutchison’s VodafoneThree stake triggers fresh CMA review on telecoms consolidation.",
  'brf-288639754b4f91e1': "JPMorgan Chase & Co.: Three new federal complaints against JPM filed within four weeks (SDNY, D. Colo., D. Conn.) — pattern review and consumer-litigation monitoring brief.",
  'brf-543eb5489aa2b16f': "Volkswagen AG: VW’s emergence as Rivian’s top shareholder (per fresh SEC filings) sets up JV restructuring or strategic-transaction review.",
  'brf-8e3242acaace4f8a': "Chevron Corporation: Chevron’s Q1 profit fall explicitly tied to Iran-war Hormuz disruption — force-majeure review of upstream and tanker contracts.",
  'brf-085e5081f82d376a': "HSBC Holdings plc: HSBC’s $400m private-credit fraud charge tied to the MFS collapse will draw FCA scrutiny on lending controls.",
  'brf-98ff347f9ecf834f': "Pfizer Inc.: Ten federal complaints filed against Pfizer on a single day (May 14) — coordinated class-action wave with immediate defence-strategy implications.",
  'brf-82374293be9e57a6': "Microsoft Corporation: Academia Sinica v. Microsoft (S.D. Fla.) — fresh patent suit from a Taiwan research institute; defence and counter-claim strategy review.",
  'brf-0859808c45927e53': "Lockheed Martin Corporation: Three new federal cases against Lockheed (E.D. Cal. × 2, N.D. Ill.) — dockets-only at filing; export-controls hook keeps Lockheed worth tracking.",
  'brf-e456c26c3297785d': "Ford Motor Company: Four federal suits against Ford in four districts in recent weeks — coordinated product-liability wave with JPML consolidation risk.",
  'brf-261be2a2038947b7': "Toyota Motor Corporation: Three Toyota Motor Credit class actions plus a Toyota NA case — TILA / consumer-credit defence pattern across four districts.",
  'brf-46bcd2efe5f4ba98': "TotalEnergies SE: Insurance Journal flags ‘billions in Hormuz oil-trade disputes’, TotalEnergies named — force-majeure clause review across crude and LNG offtake.",
  'brf-95f58f69ffa54a65': "TotalEnergies SE: TotalEnergies’ $1bn US offshore-wind walk-away opens government-contract and securities-disclosure exposure.",
  'brf-cf29cc3bcececaf0': "Stellantis N.V.: Schall and Rosen lead parallel STLA securities-fraud class actions in late April — lead-plaintiff motion deadlines in the next 2-3 weeks.",
  'brf-8a252fbc73d6440f': "Glencore plc: Fatal explosion at Glencore’s Kazzinc plant (Kazakhstan) — workplace-safety, criminal-liability and regulatory-defence work.",
  'brf-2f0c07b0dcdffef3': "BAE Systems plc: EnComm Aviation’s £120m suit against BAE over Kenya arms sales — commercial / contract dispute with reputational and export-licensing risk."
};

// ---------- #3: detemplate talking points ----------
// Pools picked deterministically via a hash of (brief id + entity) so the
// assignments don't shuffle across runs, but no two briefings reach for the
// same sentence twice in a row.
const REL_POOLS_CLIENT = [
  ent => `Existing ${ent} relationship — route the approach through the current relationship partner so the firm presents one face.`,
  ent => `Already a client; coordinate with the matter team that knows ${ent}’s commercial sensitivities before any outreach.`,
  ent => `${ent} GC has a known preferred-counsel list; existing-client status puts the firm on the inside without a beauty parade.`,
  ent => `Active engagement means the relationship partner already has standing context — fastest path is a same-day informal call.`,
  ent => `Avoid duplicating the existing matter team’s contact — the relationship partner should make the first move.`,
  ent => `Live mandate exists. Pitch this as an extension of current work, not a new instruction, to reduce procurement friction.`,
  ent => `Cross-team coordination: brief the lead partner on the open mandate before any approach so the message stays consistent.`,
  ent => `${ent} prefers existing-counsel continuity on related matters; a lead-partner introduction is the credible route.`,
  ent => `Open file with ${ent} — conflicts and panel-firm checks are already cleared, so the path to instruction is short.`
];
const REL_POOLS_PROSPECT = [
  ent => `No prior matter history with ${ent} — the credible cold-approach hook is the firm’s specific bench on this trigger, not generic capability.`,
  ent => `Cold approach. Pre-clear conflicts via the panel-firm register and lead with a one-page POV rather than a capability deck.`,
  ent => `${ent} is not on the panel; first contact should be the named partner with the closest published track record on this issue.`,
  ent => `Fresh prospect — brief the conflicts team, then route the approach through a partner with a public-record connection to the underlying matter.`,
  ent => `No prior touchpoint. Lead with a substantive memo on the specific trigger; broad capability brochures get binned.`,
  ent => `Cold prospect. Open via a thought-piece on the precise legal question, then offer a 30-minute working call rather than a pitch.`,
  ent => `${ent} has no incumbent flagged for this work; an early, specific point-of-view is the fastest route past panel inertia.`,
  ent => `No relationship to build on — confer with the sector partner before any outreach so the angle is sharp on first contact.`,
  ent => `Prospect. Conflicts pre-clearance is the first gate; second is matching the lead partner to an existing public-record connection.`,
  ent => `New name to the firm. Lead with a problem-specific draft (clause, defence framework) rather than a generic introduction.`,
  ent => `${ent} GC team is reachable through sector relationships; a warm-introduction route is preferable to a cold pitch.`,
  ent => `Cold approach justified by the specificity of the trigger — generic outreach will be ignored, a precise POV gets a meeting.`
];
const COMP_POOLS = [
  () => `Speed matters — the first credible memo in front of in-house counsel typically wins the brief on triggers like this.`,
  () => `Magic Circle competitors will be drafting the same memo by Monday; a sharper firm-specific angle is the differentiator.`,
  () => `Multiple firms will pitch on this. Differentiator is being specific about the clause, the venue, and the deadline — not the firm bio.`,
  () => `Limited competition on the precise angle (the relevant bench is narrow). A focused one-pager is enough.`,
  () => `Moderate competition expected; the firm’s published track record on the underlying clause is the most credible point of difference.`,
  () => `Competitive process likely. Lead with the named partner who has spoken publicly on the exact issue, not the practice description.`,
  () => `Field is wide — the firm wins on substance, not coverage. A two-page POV beats a fifteen-page capability deck.`,
  () => `No incumbent identified yet; the first credible POV in the in-house team’s inbox sets the agenda.`,
  () => `Niche bench — short list of firms can credibly do this work. Direct partner-to-GC contact is the right channel.`,
  () => `Competitor firms will hedge with general-practice partners; the firm’s named-specialist angle is sharper.`,
  () => `Pricing-led competition is unlikely — the work needs scarce expertise. Named-partner credibility is the lead.`
];

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return Math.abs(h);
}
function pickFn(pool, key) { return pool[hashStr(String(key)) % pool.length]; }

function extractClientEntity(point) {
  const m = point.match(/Builds on existing (.+?) engagement/i);
  return m ? m[1] : null;
}
function extractProspectEntity(point) {
  const m = point.match(/No prior matter history with (.+?)\s*[—–-]/i);
  return m ? m[1] : null;
}

// ---------- Apply fixes ----------

// Strip critic + repair headlines + scrub credentials in briefings
for (const b of snap.briefings || []) {
  if (b.basis) {
    if (HEADLINES[b.id]) {
      b.basis.oneLineHeadline = HEADLINES[b.id];
      stats.headlinesRewritten++;
    } else if (b.basis.oneLineHeadline) {
      b.basis.oneLineHeadline = stripCritic(b.basis.oneLineHeadline);
    }
    b.basis.detailedExplanation = scrubCredentials(stripCritic(b.basis.detailedExplanation || ''));
    for (const cs of b.basis.citedSources || []) {
      if (cs && typeof cs === 'object') {
        cs.url = fixCourtListenerUrl(cs.url);
        if (cs.title) cs.title = stripCritic(cs.title);
        if (cs.excerpt) cs.excerpt = stripCritic(cs.excerpt);
      }
    }
  }
  for (const tp of b.talkingPoints || []) {
    if (!tp || typeof tp.point !== 'string') continue;
    tp.point = scrubCredentials(stripCritic(tp.point));
    // Match by text, not by angle — the data tags this boilerplate as both
    // `relationship` (clients) and `positioning` (prospects).
    const clientEnt = extractClientEntity(tp.point);
    const prospectEnt = extractProspectEntity(tp.point);
    if (clientEnt) {
      tp.point = pickFn(REL_POOLS_CLIENT, b.id + clientEnt)(clientEnt);
      stats.relPointsRewritten++;
    } else if (prospectEnt) {
      tp.point = pickFn(REL_POOLS_PROSPECT, b.id + prospectEnt)(prospectEnt);
      stats.relPointsRewritten++;
    } else if (
      /multiple firms will be on this call/i.test(tp.point) ||
      /moderate competition expected/i.test(tp.point) ||
      /no identified rival/i.test(tp.point)
    ) {
      tp.point = pickFn(COMP_POOLS, b.id + 'comp')();
      stats.compPointsRewritten++;
    }
  }
  if (Array.isArray(b.auditTrail)) {
    b.auditTrail = b.auditTrail.map(at => {
      if (at && typeof at === 'object') {
        if (at.rationale) at.rationale = scrubCredentials(stripCritic(at.rationale));
        if (at.note) at.note = scrubCredentials(stripCritic(at.note));
      }
      return at;
    });
  }
}

// Scrub opps (basis/oneLineHeadline carry into card text)
for (const o of snap.opportunities || []) {
  if (o.basis && typeof o.basis === 'object') {
    for (const k of Object.keys(o.basis)) {
      if (typeof o.basis[k] === 'string') o.basis[k] = scrubCredentials(stripCritic(o.basis[k]));
    }
  }
  if (typeof o.suggestedAction === 'string') o.suggestedAction = scrubCredentials(stripCritic(o.suggestedAction));
  if (typeof o.rationale === 'string') o.rationale = scrubCredentials(stripCritic(o.rationale));
}

// Fix court URLs in signals
for (const s of snap.signals || []) {
  if (typeof s.sourceUrl === 'string') s.sourceUrl = fixCourtListenerUrl(s.sourceUrl);
  if (typeof s.url === 'string') s.url = fixCourtListenerUrl(s.url);
}

// ---------- #9: remove Anthropic entirely ----------
const ANTHROPIC_ID = 'pr-anthropic';
const removedOppIds = new Set();
const beforeProspects = snap.prospects?.length || 0;
snap.prospects = (snap.prospects || []).filter(p => p.id !== ANTHROPIC_ID);
snap.opportunities = (snap.opportunities || []).filter(o => {
  const entityRefs = [
    o.entity, o.entityId, o.subjectId, o.subjectName, o.primaryEntityId,
    o.basis && o.basis.entity, o.basis && o.basis.entityName,
    o.basis && o.basis.oneLineHeadline
  ];
  const tied = entityRefs.some(v =>
    v === ANTHROPIC_ID || (typeof v === 'string' && /\banthropic\b/i.test(v))
  );
  if (tied) {
    removedOppIds.add(o.id);
    stats.anthropicOppsRemoved++;
  }
  return !tied;
});
const beforeBriefings = snap.briefings.length;
snap.briefings = snap.briefings.filter(b => !removedOppIds.has(b.opportunityId));
stats.anthropicBriefingsRemoved = beforeBriefings - snap.briefings.length;
const beforeSignals = snap.signals?.length || 0;
snap.signals = (snap.signals || []).filter(s => {
  if (Array.isArray(s.entityIds) && s.entityIds.includes(ANTHROPIC_ID)) return false;
  if (Array.isArray(s.entities) && s.entities.some(e => e && e.entityId === ANTHROPIC_ID)) return false;
  if (typeof s.title === 'string' && /\banthropic\b/i.test(s.title)) return false;
  return true;
});
stats.anthropicSignalsRemoved = beforeSignals - snap.signals.length;
// Clear dangling queriedFor metadata on signals that survived (they’re about
// other entities and were just cross-referenced during the Anthropic query).
for (const s of snap.signals) {
  if (s.rawMetadata && /anthropic/i.test(s.rawMetadata.queriedFor || '')) {
    delete s.rawMetadata.queriedFor;
  }
}

// Seed prospects
const idx = seedProspects.findIndex(p => p.id === ANTHROPIC_ID);
if (idx >= 0) seedProspects.splice(idx, 1);

// ---------- Write ----------
fs.writeFileSync(SNAP, JSON.stringify(snap, null, 2) + '\n', 'utf8');
fs.writeFileSync(SEED_PROSPECTS, JSON.stringify(seedProspects, null, 2) + '\n', 'utf8');

console.log('Snapshot quality fixes applied.');
console.log(JSON.stringify(stats, null, 2));
console.log('Prospects:', beforeProspects, '->', snap.prospects.length);
console.log('Opportunities:', (snap.opportunities.length + removedOppIds.size), '->', snap.opportunities.length);
console.log('Briefings:', beforeBriefings, '->', snap.briefings.length);
console.log('Signals:', beforeSignals, '->', snap.signals.length);
