// Demo bake — produces data/demo-snapshot.json and data/bake-summary.json.
// Modes:
//   - online: ANTHROPIC_API_KEY set → uses real agents (Sonnet/Haiku/Opus)
//   - offline (default fallback): uses deterministic heuristics from bake-helpers.js
//     so we can produce a populated demo without API spend.
// External source credentials (COURTLISTENER_API_TOKEN, COMPANIES_HOUSE_API_KEY,
// SEC_EDGAR_USER_AGENT) gate per-source fetching but are not required for the
// bake to succeed — missing sources are skipped with warnings.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { fetchGdeltSignalsForEntity, fetchGdeltSignalsForTheme } from '../backend/sources/gdelt.js';
import { fetchTavilySignalsForEntity, fetchTavilySignalsForTheme, hasTavilyAccess } from '../backend/sources/tavily.js';
import { fetchEdgarFilings } from '../backend/sources/edgar.js';
import { fetchCourtListenerForEntity } from '../backend/sources/courtlistener.js';
import { fetchCompaniesHouseFilings, fetchCompaniesHouseOfficers } from '../backend/sources/companiesHouse.js';
import { fetchFederalRegisterRecent } from '../backend/sources/federalRegister.js';
import { fetchRssFeed } from '../backend/sources/rssSources.js';
import { fetchFdaWarningLetters } from '../backend/sources/fdaWarningLetters.js';
import { fetchOfacSdn, fetchUkOfsi, crossReferenceSanctions } from '../backend/sources/sanctions.js';
import { deduplicateSignals } from '../backend/lib/dedupe.js';
import { linkEntities } from '../backend/lib/entities.js';
import { annotateFusion } from '../backend/lib/signalFusion.js';
import { addAuditEntry } from '../backend/lib/audit.js';
import {
  classifySignalHeuristic, pickServiceFromSignal,
  buildHeuristicBriefing, buildOpportunityHeuristic
} from './bake-helpers.js';
import { composeOpportunity } from '../backend/agents/opportunityComposer.js';
import { generateBriefing } from '../backend/agents/briefingGenerator.js';
import { critiqueRecommendation } from '../backend/agents/methodologyCritic.js';
import { classifySignalsLLM } from '../backend/agents/signalClassifier.js';
import { screenEventForClients } from '../backend/agents/eventScreener.js';
import { screenProspect } from '../backend/agents/prospectScreener.js';
import { generateOppsFromEvent } from '../backend/agents/marketScreeningAgent.js';
import { extractScreeningEvents, getEventSignals } from '../backend/lib/eventClusters.js';
import { hasAmbientLLMAccess, getUsageReport, resetUsage } from '../backend/agents/client.js';
import { detectBakeProvider } from '../backend/lib/llm/index.js';
import { opportunityId } from '../backend/lib/ids.js';

// Wrap buildOpportunityHeuristic so that when LLM access is available, the
// agent overlays its summary/reasoning/scoring on the heuristic's structural
// routing. Failures fall back to heuristic silently — never abort the bake.
let llmComposeCtr = 0;
let llmComposeFailures = 0;
let criticDropped = 0;
let criticDemoted = 0;
let criticPassed = 0;
let preFilteredSanctions = 0;

const SANCTIONS_SOURCES = new Set(['ofac_sdn', 'eu_sanctions', 'uk_ofsi', 'sanctions_cross_ref']);

async function buildOpportunity(args, context = '') {
  // === Pre-LLM deterministic filter: sanctions are compliance escalations,
  // NOT business-development opportunities. Drop any opp where the supporting
  // signals are sanctions-only — these used to surface as "Compliance Alert"
  // cards routed to unrelated services like UK/EU competition (because the
  // cross-sell engine pattern-matched on entity peer-cluster while the only
  // evidence was a substring match against an unrelated sanctioned entity).
  // Cheaper than burning an LLM critic call to reach the same verdict.
  if (args.signals?.length && args.signals.every(s => SANCTIONS_SOURCES.has(s.source))) {
    preFilteredSanctions++;
    process.stdout.write(`[bake] pre-filter sanctions-only: ${args.entity.legalName} / ${args.service} → DROPPED (compliance, not BD)\n`);
    return null;
  }

  const heuristic = buildOpportunityHeuristic(args);
  if (!hasAmbientLLMAccess()) return heuristic;
  llmComposeCtr++;
  process.stdout.write(`[bake] llm-compose ${llmComposeCtr}: ${args.entity.legalName} / ${args.service}… `);
  try {
    const llmOpp = await composeOpportunity({
      entity: args.entity,
      entityType: heuristic.entityType,
      suggestedService: args.service,
      signals: args.signals,
      engineSource: args.engineSource,
      relevantMatters: (args.matters || []).filter(m => m.client === args.entity.id).slice(0, 3),
      peerContext: args.peerContext || null,
      // Pass the screener's exposure finding through so the composer
      // anchors on the same logic chain the screener used (this is the
      // single largest lever on the previous ~52% critic-drop rate — the
      // composer was independently re-deriving exposure and getting it
      // wrong).
      exposureContext: args.exposureContext || null
    });
    process.stdout.write('ok ');
    // Keep heuristic id + structural fields (so the same opp ID is stable and
    // signal IDs / matter refs match what the engine routed). Overlay LLM
    // text + LLM-judged scoring on top.
    const composed = {
      ...heuristic,
      urgencyTier: llmOpp.urgencyTier || heuristic.urgencyTier,
      confidence: typeof llmOpp.confidence === 'number' ? llmOpp.confidence : heuristic.confidence,
      score: typeof llmOpp.score === 'number' ? llmOpp.score : heuristic.score,
      competitiveContext: llmOpp.competitiveContext || heuristic.competitiveContext,
      estimatedRevenue: llmOpp.estimatedRevenue ?? heuristic.estimatedRevenue,
      // Triggers + severity from the composer (mined from launch-radar
      // cookbook pattern). Fall back to the heuristic-derived values when the
      // LLM didn't produce them — never silently drop these fields, the UI
      // filters depend on them.
      triggers: Array.isArray(llmOpp.triggers) && llmOpp.triggers.length ? llmOpp.triggers : heuristic.triggers,
      severity: ['p0', 'p1', 'p2', 'p3'].includes(llmOpp.severity) ? llmOpp.severity : heuristic.severity,
      basis: {
        ...heuristic.basis,
        summary: llmOpp.basis?.summary || heuristic.basis.summary,
        reasoning: llmOpp.basis?.reasoning || heuristic.basis.reasoning
      }
    };

    // === Composer self-flag short-circuit ===
    // The composer prompt instructs it to prefix the summary with
    // "Weak signal" when the signal pool doesn't actually support a
    // confident BD recommendation. Trust that signal — drop the opp
    // immediately rather than burning a critic call. The composer has
    // already concluded the case is too thin. Match is dash-optional:
    // the composer occasionally writes "Weak signal." or "Weak signal:"
    // and the previous /weak signal\s*[—\-]/ regex missed both.
    if (typeof composed.basis?.summary === 'string' && /^\s*weak signal\b/i.test(composed.basis.summary)) {
      criticDropped++;
      process.stdout.write('composer-self-flagged weak → DROPPED\n');
      return null;
    }

    // === Quality gate: methodology critic ===
    // Run the critic against the composed opp + its actual cited signals.
    // Severity routes (now matching the documented critic schema in
    // backend/agents/methodologyCritic.js — previously MAJOR was treated
    // identically to BLOCKER which dropped ~half of recoverable opps):
    //   - blocker: drop the opp entirely (return null)
    //   - major:   keep but CAP SCORE AT 30 and prepend the warning to
    //              the partner-facing summary so reviewers see the issue
    //   - minor / none: pass through
    process.stdout.write('crit… ');
    try {
      const critique = await critiqueRecommendation(composed, {
        entity: args.entity,
        signals: args.signals,
        peerContext: args.peerContext || null
      });
      const sev = critique?.severity || 'none';
      if (sev === 'blocker') {
        criticDropped++;
        process.stdout.write(`DROPPED (${(critique.issues || []).slice(0, 2).join('; ').slice(0, 100)})\n`);
        return null;
      }
      if (sev === 'major') {
        criticDemoted++;
        const issue = (critique.issues || [])[0]?.slice(0, 120) || 'major methodology issue';
        const warning = `[Critic flagged — review needed: ${issue}] `;
        composed.score = Math.min(composed.score ?? 30, 30);
        composed.confidence = Math.min(composed.confidence ?? 0.4, 0.4);
        composed.basis = {
          ...composed.basis,
          summary: warning + (composed.basis?.summary || ''),
          criticIssues: critique.issues || []
        };
        process.stdout.write(`MAJOR → DEMOTED (score capped at 30: ${issue.slice(0, 70)})\n`);
        return composed;
      }
      criticPassed++;
      process.stdout.write('pass\n');
      return composed;
    } catch (err) {
      // Critic failure shouldn't block the bake — fall through with the
      // composed opp. Don't double-charge as a compose failure.
      process.stdout.write(`crit-fail (${err.message?.slice(0, 60)})\n`);
      return composed;
    }
  } catch (err) {
    llmComposeFailures++;
    process.stdout.write(`fallback (${err.message?.slice(0, 60)})\n`);
    return heuristic;
  }
}

let llmBriefCtr = 0;
let llmBriefFailures = 0;

async function buildBriefingPolished(workspace, opp) {
  const entity = [...workspace.clients, ...workspace.prospects].find(e => e.id === opp.entity);
  const signals = (workspace.signals || []).filter(s => (opp.basis?.signalIds || []).includes(s.id));
  if (!hasAmbientLLMAccess()) {
    return buildHeuristicBriefing(opp, entity, signals, workspace.matters);
  }
  llmBriefCtr++;
  process.stdout.write(`[bake] llm-brief ${llmBriefCtr}: ${entity?.legalName || opp.entity}… `);
  try {
    const briefing = await generateBriefing({ workspace, opportunity: opp });
    process.stdout.write('ok\n');
    return briefing;
  } catch (err) {
    llmBriefFailures++;
    process.stdout.write(`fallback (${err.message?.slice(0, 60)})\n`);
    return buildHeuristicBriefing(opp, entity, signals, workspace.matters);
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, '..', 'data');
const seedDir = path.join(dataDir, 'seed');

if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === undefined && process.env.SKIP_TLS_FIX !== '1') {
  // JKH corporate proxy SSL workaround — only active when explicitly opted in via env.
  // process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const THEMES_TO_FETCH = [
  'Strait of Hormuz tanker shipping',
  'Red Sea shipping disruption Houthi',
  'EU AI Act enforcement Microsoft',
  'OFAC sanctions designation Russia',
  'force majeure shipping container',
  'climate litigation oil major',
  'export controls semiconductors China',
  'pharmaceutical patent litigation biosimilar',
  'FCA enforcement bank',
  'DG COMP merger cloud'
];

function readSeed(name) { return JSON.parse(fs.readFileSync(path.join(seedDir, name), 'utf8')); }

function nowIso() { return new Date().toISOString(); }

// Sources whose pre-tagged entity attribution is UNRELIABLE — they fire on
// keywords/themes that may or may not be about a specific known entity. For
// these, drop any pre-tags and re-link via word-boundary regex on the title +
// description. Sources omitted here (gdelt per-entity, edgar per-CIK,
// companies-house) do reliably know the entity at fetch time, so their tags
// stand.
const UNRELIABLE_PRETAG_SOURCES = new Set([
  'gdelt',          // theme queries return results across many entities
  'tavily',         // same — entity queries can match articles that mention
                    // the entity only in passing; deep-link verifies mention
  'fca', 'doj', 'ftc', 'dg_comp',
  'lexology', 'jd_supra',
  'federal_register'
]);

function deepLinkEntities(signal, clients, prospects) {
  // Always re-link signals from unreliable-pretag sources, even when they
  // already have entity tags — those tags may have come from a fetcher that
  // tagged every result with a single queried entity name, regardless of
  // whether the article actually mentions that entity.
  const sourceUnreliable = UNRELIABLE_PRETAG_SOURCES.has(signal.source);
  if (!sourceUnreliable && (signal.entities || []).some(e => e.entityId)) return signal;
  const text = `${signal.title || ''} ${signal.description || ''}`;
  const links = linkEntities(text, clients, prospects);
  if (links.length) {
    signal.entities = links;
  } else if (sourceUnreliable) {
    // No genuine word-boundary mention — drop bogus pre-tags entirely. The
    // signal will be skipped by entity-driven engines but stays available
    // for the audit trail.
    signal.entities = [];
  }
  return signal;
}

async function ingestRound(clients, prospects, opts) {
  const allSignals = [];
  const perSource = {};
  const entities = [...clients, ...prospects];

  // News fetch per entity. Tavily is the primary source — it's purpose-built
  // for AI agents, returns rich content excerpts (not just titles), and is
  // dramatically more reliable than GDELT's public API which times out under
  // load. We retain GDELT as a no-cost supplementary source: when Tavily
  // succeeds for an entity, GDELT is skipped to avoid double-fetching the
  // same news. When Tavily is absent or fails, GDELT runs as fallback.
  const tavilyOn = hasTavilyAccess();
  if (tavilyOn) console.log('[bake] tavily: ENABLED — primary news source');
  const newsLimit = opts.gdeltEntities ?? entities.length;
  for (let i = 0; i < newsLimit; i++) {
    const e = entities[i];
    let sigs = [];
    if (tavilyOn) {
      console.log(`[bake] tavily: ${e.legalName}`);
      try {
        // Pass legalName + aliases so the query OR-matches the curated
        // short forms ("BP", "HSBC", "Maersk"). The previous quoted
        // legalName-only query was missing real articles that referred
        // to the entity only by its short form.
        sigs = await fetchTavilySignalsForEntity(
          { legalName: e.legalName, aliases: e.knownAliases || [] },
          { days: 14, maxRecords: 8 }
        );
      } catch (err) {
        console.warn(`[bake] tavily failed for ${e.legalName}: ${err.message}`);
        sigs = [];
      }
      perSource.tavily = (perSource.tavily || 0) + sigs.length;
    }
    if (!sigs.length) {
      console.log(`[bake] gdelt fallback: ${e.legalName}`);
      const gsigs = await fetchGdeltSignalsForEntity(e.legalName, { timespan: '14d', maxRecords: 10 });
      perSource.gdelt = (perSource.gdelt || 0) + gsigs.length;
      sigs = gsigs;
    }
    const tagged = sigs.map(s => ({ ...s, entities: [{ entityType: e.id.startsWith('pr-') ? 'prospect' : 'client', entityId: e.id, mentionedAs: e.legalName, confidence: 0.95 }] }));
    allSignals.push(...tagged);
  }

  // Theme queries — global news on cross-cutting topics (Hormuz, AI Act, etc.).
  // Tavily again primary; GDELT fallback for missing themes.
  for (const theme of THEMES_TO_FETCH.slice(0, opts.maxThemes ?? THEMES_TO_FETCH.length)) {
    let sigs = [];
    if (tavilyOn) {
      console.log(`[bake] tavily theme: ${theme}`);
      try {
        sigs = await fetchTavilySignalsForTheme(theme, { days: 7, maxRecords: 8 });
      } catch (err) {
        console.warn(`[bake] tavily theme failed (${theme}): ${err.message}`);
        sigs = [];
      }
      perSource.tavily = (perSource.tavily || 0) + sigs.length;
    }
    if (!sigs.length) {
      console.log(`[bake] gdelt theme fallback: ${theme}`);
      const gsigs = await fetchGdeltSignalsForTheme(theme, { timespan: '7d', maxRecords: 8 });
      perSource.gdelt = (perSource.gdelt || 0) + gsigs.length;
      sigs = gsigs;
    }
    allSignals.push(...sigs);
  }

  // SEC EDGAR per US-listed entity.
  for (const e of entities) {
    const cik = e.externalIdentifiers?.secCik;
    if (!cik) continue;
    console.log(`[bake] edgar: ${e.legalName}`);
    const sigs = await fetchEdgarFilings(cik, { sinceDate: opts.sinceDate, entityName: e.legalName });
    const tagged = sigs.map(s => ({ ...s, entities: [{ entityType: e.id.startsWith('pr-') ? 'prospect' : 'client', entityId: e.id, mentionedAs: e.legalName, confidence: 1.0 }] }));
    allSignals.push(...tagged);
    perSource.edgar = (perSource.edgar || 0) + sigs.length;
  }

  // CourtListener per entity. Do NOT pre-tag with the queried entity —
  // CourtListener returns lots of spurious matches and the deepLinkEntities
  // pass below will properly link cases that actually mention the entity in
  // the case caption (via word-boundary regex). Cases that don't link to any
  // known entity drop out of entity-driven opportunities, which is correct.
  if (process.env.COURTLISTENER_API_TOKEN) {
    for (const e of entities) {
      console.log(`[bake] courtlistener: ${e.legalName}`);
      const sigs = await fetchCourtListenerForEntity(e.legalName, { sinceDate: opts.sinceDate });
      allSignals.push(...sigs);
      perSource.courtlistener = (perSource.courtlistener || 0) + sigs.length;
    }
  } else {
    console.warn('[bake] COURTLISTENER_API_TOKEN not set — skipping CourtListener');
  }

  // Companies House for UK-registered entities.
  if (process.env.COMPANIES_HOUSE_API_KEY) {
    for (const e of entities) {
      const num = e.externalIdentifiers?.companiesHouseNumber;
      if (!num) continue;
      console.log(`[bake] companies house: ${e.legalName}`);
      const filings = await fetchCompaniesHouseFilings(num, { entityName: e.legalName });
      const officers = await fetchCompaniesHouseOfficers(num, { entityName: e.legalName });
      const tagged = [...filings, ...officers].map(s => ({ ...s, entities: [{ entityType: e.id.startsWith('pr-') ? 'prospect' : 'client', entityId: e.id, mentionedAs: e.legalName, confidence: 1.0 }] }));
      allSignals.push(...tagged);
      perSource.companies_house = (perSource.companies_house || 0) + tagged.length;
    }
  } else {
    console.warn('[bake] COMPANIES_HOUSE_API_KEY not set — skipping Companies House');
  }

  // Federal Register (recent docs).
  console.log('[bake] federal register');
  const fr = await fetchFederalRegisterRecent({ sinceDate: opts.sinceDate, perPage: 20 });
  allSignals.push(...fr);
  perSource.federal_register = fr.length;

  // RSS sources — pruned 2026-05-13 to drop 10 silent feeds (lexology,
  // jd_supra, eur_lex, ny_ag, ca_ag, epa, ico, ftc-old, dg_comp-old,
  // fda_warning_letters) that consistently 404 / paywall / time out. Their
  // coverage is already provided by Tavily news. Replaced with reliable
  // gov.uk Atom feeds (FCA, CMA, ICO, Ofcom, BoE, HMT) that actually
  // produce signals. Each source is independent — one failing doesn't
  // block the others.
  const RSS_SOURCES = [
    // US regulators (kept; doj works, ftc/cftc tested)
    'doj', 'ftc', 'cftc',
    // EU
    'dg_comp',
    // UK regulators — dual feeds where available (the .org.uk feed +
    // the gov.uk Atom feed) for cross-corroboration.
    'fca', 'cma',
    'fca_govuk', 'ico_govuk', 'ofcom', 'bank_of_england', 'hmt'
  ];
  for (const src of RSS_SOURCES) {
    console.log(`[bake] rss: ${src}`);
    const sigs = await fetchRssFeed(src);
    allSignals.push(...sigs);
    perSource[src] = sigs.length;
  }

  // FDA Warning Letters — HTML scrape kept for now; URL still 404s but
  // wrapper returns [] gracefully. Re-enable when fda.gov restores layout.
  console.log('[bake] fda_warning_letters');
  try {
    const fdaSigs = await fetchFdaWarningLetters({ maxRecords: 30 });
    allSignals.push(...fdaSigs);
    perSource.fda_warning_letters = fdaSigs.length;
  } catch (err) {
    console.warn(`[bake] fda_warning_letters failed: ${err.message}`);
    perSource.fda_warning_letters = 0;
  }

  // Sanctions cross-reference (cached).
  console.log('[bake] sanctions cross-reference');
  const names = entities.flatMap(e => [e.legalName, ...(e.knownAliases || [])]);
  const [ofac, ukOfsi] = await Promise.all([fetchOfacSdn().catch(() => []), fetchUkOfsi().catch(() => [])]);
  const sancSig = crossReferenceSanctions(names, [...ofac, ...ukOfsi]);
  allSignals.push(...sancSig);
  perSource.sanctions_cross_ref = sancSig.length;

  // Entity link untagged signals.
  for (const s of allSignals) deepLinkEntities(s, clients, prospects);

  return { allSignals, perSource };
}

async function classifyAllSignals(signals, audit) {
  // First pass: heuristic always runs — it computes affectedIndustries +
  // candidatePracticeAreas (string-list features the LLM classifier
  // doesn't bother with) AND serves as the fallback for any LLM-batch
  // failure. The heuristic's significance/topic decisions get overwritten
  // by the LLM classifier when LLM access is available.
  for (const s of signals) {
    const c = classifySignalHeuristic(s);
    s.classifiedAt = nowIso();
    s.isLegallySignificant = c.isLegallySignificant;
    s.legalSignificanceReason = c.reason;
    s.affectedIndustries = c.affectedIndustries;
    s.candidatePracticeAreas = c.candidatePracticeAreas;
    s.eventTopic = c.eventTopic;
    s.classifiedBy = 'heuristic';
  }

  // Second pass: LLM classifier (Haiku, batched 20/call). Replaces the
  // heuristic's significance + topic with a senior-partner judgment call.
  // ~21 calls for a 400-signal bake, ~$0.05 cost, ~60s runtime.
  if (hasAmbientLLMAccess()) {
    console.log(`[bake] running LLM classifier on ${signals.length} signals…`);
    const { llmHits, fallbackHits } = await classifySignalsLLM(signals, undefined, classifySignalHeuristic);
    console.log(`[bake] LLM classifier: ${llmHits} LLM-classified, ${fallbackHits} heuristic-fallback`);
  } else {
    console.log('[bake] no LLM access — keeping heuristic classification');
  }

  let significant = 0;
  for (const s of signals) {
    audit({ type: 'classification', actor: `signal_classifier_${s.classifiedBy || 'heuristic'}`, inputs: { signalId: s.id }, outputs: { isLegallySignificant: s.isLegallySignificant, topic: s.eventTopic } });
    if (s.isLegallySignificant) significant++;
  }
  return significant;
}

async function generateCrossSellOpportunities(workspace, audit) {
  const opps = [];
  const matrix = {};
  for (const c of workspace.clients) matrix[c.id] = new Set();
  for (const m of workspace.matters) {
    if (!matrix[m.client]) matrix[m.client] = new Set();
    (m.services || []).forEach(s => matrix[m.client].add(s));
  }

  const clusters = {};
  for (const c of workspace.clients) {
    const key = `${c.sector}::${c.size}`;
    if (!clusters[key]) clusters[key] = [];
    clusters[key].push(c);
  }

  for (const [key, members] of Object.entries(clusters)) {
    // Skip clusters too small for meaningful peer comparison. With <3 members
    // (peer count 0-1), every "gap" is statistical noise dressed as insight.
    // Real peer-firm benchmarking needs ≥3 peers to mean anything.
    if (members.length < 3) continue;
    for (const client of members) {
      const ownServices = matrix[client.id];
      const peerService = new Map();
      for (const peer of members) {
        if (peer.id === client.id) continue;
        for (const svc of matrix[peer.id] || []) {
          peerService.set(svc, (peerService.get(svc) || 0) + 1);
        }
      }
      const peerCount = members.length - 1;
      // Lift adoption threshold to ≥66%: a service is a real "gap" only when
      // ≥2 of every 3 peers use it (and the client doesn't). The previous
      // 40% threshold combined with 1-peer clusters made every coincidence
      // a "gap".
      const gaps = Array.from(peerService.entries())
        .filter(([svc, count]) => !ownServices.has(svc) && count / peerCount >= 0.66)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2);

      for (const [svc, count] of gaps) {
        // Pick the 3 NEWEST significant signals for this client. The
        // previous .slice(-3) returned the last 3 in array (ingestion)
        // order, which is arbitrary — could be the oldest signals
        // depending on per-source fetch sequencing.
        const recentSignals = (workspace.signals || [])
          .filter(s => (s.entities || []).some(e => e.entityId === client.id) && s.isLegallySignificant)
          .sort((a, b) => {
            const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
            const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
            return tb - ta;
          })
          .slice(0, 3);
        // Build peer context — names of peer firms that DO use this service —
        // so the composer/critic can write a substantive cross-sell argument
        // rather than blocker-dropping it for "no signals".
        const peerNamesUsing = members
          .filter(m => m.id !== client.id && (matrix[m.id] || new Set()).has(svc))
          .map(m => m.legalName);
        const peerContext = {
          cluster: key,
          peerCount,
          peersUsingService: count,
          peerNamesUsing
        };
        const opp = await buildOpportunity({
          entity: client,
          signals: recentSignals,
          service: svc,
          engineSource: 'cross_sell',
          matters: workspace.matters,
          peerContext
        });
        if (!opp) continue; // critic dropped it
        opps.push(opp);
        audit({
          type: 'engine_run',
          actor: hasAmbientLLMAccess() ? 'cross_sell_engine_llm' : 'cross_sell_engine_heuristic',
          inputs: { clientId: client.id },
          outputs: { service: svc, penetration: count / peerCount }
        });
      }
    }
  }
  return opps.slice(0, 28);
}

// Event-driven engine, cluster-first.
//
// Old approach (deprecated): scan each significant signal individually, pick
// a service via regex, group by (entityId, service). Required every signal
// to be entity-pre-tagged, missed cross-cutting events affecting multiple
// clients in different ways. Produced 1 opp in v6.
//
// New approach: cluster signals into "global events" (topic + ISO-week),
// then for each event ask an LLM "which of our clients are exposed to this,
// and what mandate does each have?". The senior-partner reasoning happens
// at routing time, not just composition time.
let eventClustersScreened = 0;
let eventScreenerSkipped = 0;

async function generateEventDrivenOpportunities(workspace, audit) {
  const events = extractScreeningEvents(workspace.signals || [], { limit: 30 });
  console.log(`[bake] event clustering: ${events.length} clusters identified for screening`);

  const opps = [];
  const seenOppIds = new Set();
  for (const event of events) {
    if (opps.length >= 22) break;
    const signals = getEventSignals(workspace.signals, event.eventKey);
    if (!signals.length) continue;

    if (!hasAmbientLLMAccess()) {
      // Without LLM, fall back to old single-entity behavior: pick first
      // entity-linked signal in the cluster, route by regex. The cluster
      // approach is fundamentally LLM-driven; no equivalent heuristic.
      const linked = signals.find(s => (s.entities || []).some(e => e.entityId));
      if (!linked) continue;
      const ent = workspace.clients.concat(workspace.prospects).find(e =>
        (linked.entities || []).some(x => x.entityId === e.id));
      const pick = pickServiceFromSignal(linked);
      if (!ent || !pick) continue;
      const opp = await buildOpportunity({
        entity: ent, signals: signals.slice(0, 5), service: pick.service,
        engineSource: 'event_intelligence', matters: workspace.matters
      });
      if (opp && !seenOppIds.has(opp.id)) { seenOppIds.add(opp.id); opps.push(opp); }
      continue;
    }

    // Pre-filter the roster passed to the screener: an entity qualifies
    // either by being mentioned in ≥2 signals of the cluster, OR by
    // appearing in the cluster's focal (most-recent) signal. The previous
    // ≥1-mention bar still let the LLM see entities mentioned once in
    // passing — those drove roughly half the critic-stage drops (cross-
    // entity false attribution). Focal-signal entities are exempt because
    // the most-recent signal is what named the cluster, so even a single
    // mention there is signal-strong, not noise.
    const mentionCounts = new Map();
    for (const sig of signals) {
      for (const e of (sig.entities || [])) {
        if (!e.entityId) continue;
        mentionCounts.set(e.entityId, (mentionCounts.get(e.entityId) || 0) + 1);
      }
    }
    const focalSignal = [...signals].sort((a, b) => {
      const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return tb - ta;
    })[0];
    const focalEntityIds = new Set((focalSignal?.entities || []).map(e => e.entityId).filter(Boolean));
    const eligibleIds = new Set();
    for (const [entityId, count] of mentionCounts.entries()) {
      if (count >= 2 || focalEntityIds.has(entityId)) eligibleIds.add(entityId);
    }
    const filteredClients = workspace.clients.filter(c => eligibleIds.has(c.id));
    const filteredProspects = workspace.prospects.filter(p => eligibleIds.has(p.id));
    if (!filteredClients.length && !filteredProspects.length) {
      // No roster entity actually mentioned — skip this cluster.
      // Still increment the screened counter for visibility.
      eventClustersScreened++;
      const eventLabel = `${event.eventTopic} (${event.week}, ${signals.length}sig/${event.sourceCount}src)`;
      process.stdout.write(`[bake] event-screen ${eventClustersScreened}: ${eventLabel}… 0 roster entities mentioned, skip\n`);
      continue;
    }

    // LLM event screening
    eventClustersScreened++;
    const eventLabel = `${event.eventTopic} (${event.week}, ${signals.length}sig/${event.sourceCount}src, roster=${filteredClients.length + filteredProspects.length})`;
    process.stdout.write(`[bake] event-screen ${eventClustersScreened}: ${eventLabel}… `);
    let screenResult;
    try {
      screenResult = await screenEventForClients({
        event: {
          eventKey: event.eventKey,
          eventTopic: event.eventTopic,
          week: event.week,
          jurisdictions: event.jurisdictions,
          industries: event.industries,
          signalCount: event.signalCount,
          sourceCount: event.sourceCount
        },
        signals: signals.slice(0, 8), // cap input
        clients: filteredClients,
        prospects: filteredProspects,
        matters: workspace.matters
      });
    } catch (err) {
      eventScreenerSkipped++;
      process.stdout.write(`SKIP (${err.message?.slice(0, 60)})\n`);
      continue;
    }
    const exposureCount = screenResult.exposures.length;
    process.stdout.write(`${exposureCount} exposure(s) returned\n`);
    if (!exposureCount) continue;

    // For each exposure, run through the existing buildOpportunity quality
    // gate. Reuses critic + partner-retry + sanctions filter automatically.
    // CRUCIAL: pass the screener's exposure finding through to the composer
    // — that's how the composer anchors on the screener's already-derived
    // exposure logic instead of re-deriving (badly) from the raw signals.
    // This was the single largest contributor to the previous ~52% critic
    // drop rate; the composer was treating the screener's careful entity
    // selection as if it were random.
    for (const exposure of screenResult.exposures) {
      if (opps.length >= 22) break;
      const entity = workspace.clients.concat(workspace.prospects).find(e => e.id === exposure.entityId);
      if (!entity) continue; // already filtered by screener but defensive
      const opp = await buildOpportunity({
        entity,
        signals: signals.slice(0, 5),
        service: exposure.service,
        engineSource: 'event_intelligence',
        matters: workspace.matters,
        exposureContext: {
          eventInterpretation: screenResult.eventInterpretation,
          rationale: exposure.rationale,
          service: exposure.service,
          urgency: exposure.urgency,
          confidence: exposure.confidence
        }
      });
      if (!opp) continue;
      // Annotate with the originating event so the UI can group / link.
      opp.basis = { ...opp.basis, eventClusterKey: event.eventKey, eventInterpretation: screenResult.eventInterpretation };
      if (seenOppIds.has(opp.id)) continue; // dedupe across events
      seenOppIds.add(opp.id);
      opps.push(opp);
      audit({
        type: 'engine_run',
        actor: 'event_intelligence_screener',
        inputs: { eventKey: event.eventKey, entityId: entity.id, signalIds: signals.map(s => s.id) },
        outputs: { service: exposure.service, urgency: exposure.urgency, confidence: exposure.confidence }
      });
    }
  }
  return opps;
}

// Auto-discover new prospect entities from top event clusters. Walks the
// 6 most-corroborated multi-source clusters, runs the marketScreeningAgent,
// and persists any returned newProspect entities + opps. Each discovered
// prospect gets a stable ID `pr-screen-<slug>` and `discoverySource:
// 'auto_event_screening'` so they're distinguishable from seed prospects.
//
// Cost: ~6 Sonnet calls × ~3K tokens ≈ $0.50. High demo value — "Look,
// the platform found these new targets you weren't tracking."
let autoProspectsDiscovered = 0;
let autoProspectClustersScreened = 0;

function slugifyName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

async function discoverNewProspectsFromEvents(workspace, audit) {
  if (!hasAmbientLLMAccess()) return [];
  const events = extractScreeningEvents(workspace.signals || [], { limit: 12 });
  // Prefer multi-source corroborated clusters — those represent real events,
  // not single-article speculation. Cap at 6 to keep cost bounded.
  const topEvents = events
    .filter(e => e.sourceCount >= 2 || e.signalCount >= 4)
    .slice(0, 6);
  if (!topEvents.length) {
    console.log('[bake] auto-prospect-discovery: no eligible multi-source clusters to mine');
    return [];
  }
  console.log(`[bake] auto-prospect-discovery: mining ${topEvents.length} top clusters for new entities…`);

  const opps = [];
  const seenOppIds = new Set();
  const now = new Date().toISOString();

  for (const event of topEvents) {
    autoProspectClustersScreened++;
    const eventLabel = `${event.eventTopic} (${event.week}, ${event.signalCount}sig/${event.sourceCount}src)`;
    process.stdout.write(`[bake] auto-prospect ${autoProspectClustersScreened}: ${eventLabel}… `);
    const signals = getEventSignals(workspace.signals, event.eventKey);
    if (!signals.length) { process.stdout.write('no signals\n'); continue; }

    let result;
    try {
      result = await generateOppsFromEvent({ event, signals: signals.slice(0, 8), workspace });
    } catch (err) {
      process.stdout.write(`fail (${err.message?.slice(0, 60)})\n`);
      continue;
    }
    // Keep BOTH newProspect AND existingId entityRefs. Earlier this filter
    // only kept newProspect, dropping the ~70-80% of screener output that
    // referenced existing roster entities — those are legitimate additional
    // event-driven opps the EventScreener may have missed (different model,
    // different framing). Route them all through buildOpportunity so they
    // get the same quality gate as everything else.
    const screenerOpps = (result.opportunities || []).filter(o => o.entityRef?.newProspect || o.entityRef?.existingId);
    const newProspectCount = screenerOpps.filter(o => o.entityRef?.newProspect).length;
    const existingCount = screenerOpps.length - newProspectCount;
    process.stdout.write(`${newProspectCount} new prospect(s) + ${existingCount} existing\n`);

    for (const o of screenerOpps) {
      let entityObj;
      let isNew = false;
      if (o.entityRef?.newProspect) {
        const np = o.entityRef.newProspect;
        const newId = `pr-screen-${slugifyName(np.legalName)}`;
        // Promote the new entity to workspace.prospects (or skip if already added).
        const existing = (workspace.prospects || []).find(p => p.id === newId)
          || (workspace.clients || []).find(c => c.id === newId);
        if (existing) {
          entityObj = existing;
        } else {
          entityObj = {
            id: newId,
            legalName: np.legalName,
            knownAliases: np.knownAliases || [],
            sector: np.sector,
            subSector: null,
            hqJurisdiction: np.hqJurisdiction,
            countriesOfOperation: [],
            size: 'unknown',
            externalIdentifiers: {},
            decisionMakers: [],
            discoverySource: 'auto_event_screening',
            discoveryEventKey: event.eventKey,
            discoveryRationale: np.discoveryRationale || '',
            fitScore: o.confidence || 0.6
          };
          workspace.prospects = workspace.prospects || [];
          workspace.prospects.push(entityObj);
          autoProspectsDiscovered++;
          isNew = true;
        }
      } else {
        // existingId path — look up the entity in clients or prospects.
        const ref = o.entityRef.existingId;
        entityObj = (workspace.clients || []).find(c => c.id === ref)
          || (workspace.prospects || []).find(p => p.id === ref);
        if (!entityObj) continue;  // stale reference — skip
      }
      // Route through buildOpportunity so auto-discovered opps get the
      // same sanctions pre-filter, partner-retry and methodology-critic
      // gate that every other opp goes through. Previously the screener's
      // output was trusted directly — one hallucinated entity or sanctions
      // false-positive went straight to the partner-facing card.
      // Pass the screener's per-opportunity rationale + event interpretation
      // through so the composer doesn't re-derive exposure (same fix as
      // event_intelligence path — anchors composer on screener's logic).
      // Engine label: brand-new prospects → prospect_discovery (consistent
      // with the seed-prospect path); existing-entity hits from market
      // screening → event_intelligence (this IS event-driven exposure).
      const engineLabel = isNew ? 'prospect_discovery' : 'event_intelligence';
      const opp = await buildOpportunity({
        entity: entityObj,
        signals: signals.slice(0, 5),
        service: o.service,
        engineSource: engineLabel,
        matters: (workspace.matters || []).filter(m => m.client === entityObj.id).slice(0, 5),
        exposureContext: {
          eventInterpretation: result.eventInterpretation,
          rationale: o.reasoning || o.summary,
          service: o.service,
          urgency: o.urgency,
          confidence: o.confidence
        }
      });
      if (!opp) continue;
      // Preserve the discovery provenance after critic gating so the UI can
      // still distinguish auto-discovered prospects from seed-prospect opps.
      // Existing-entity hits keep their natural event_driven typing.
      if (isNew) {
        opp.type = 'auto_prospect';
        opp.notes = 'AUTO-DISCOVERED from market events. Verify entity + solicitation compliance before outreach.';
      } else if ((workspace.prospects || []).some(p => p.id === entityObj.id)) {
        opp.notes = opp.notes || 'PROSPECT — review for solicitation compliance before outreach.';
      }
      opp.basis = {
        ...opp.basis,
        eventClusterKey: event.eventKey,
        eventInterpretation: result.eventInterpretation
      };
      if (seenOppIds.has(opp.id) || (workspace.opportunities || []).some(x => x.id === opp.id)) continue;
      seenOppIds.add(opp.id);
      opps.push(opp);
      audit({
        type: 'engine_run',
        actor: 'auto_prospect_discovery',
        inputs: { eventKey: event.eventKey, entity: entityObj.legalName, isNew },
        outputs: { service: o.service, urgency: o.urgency, confidence: o.confidence }
      });
    }
  }
  console.log(`[bake] auto-prospect-discovery: ${autoProspectsDiscovered} new prospect entities, ${opps.length} opportunities`);
  return opps;
}

async function generateProspectOpportunities(workspace, audit) {
  const opps = [];
  const seenOppIds = new Set();
  for (const prospect of workspace.prospects) {
    const signals = (workspace.signals || []).filter(s =>
      (s.entities || []).some(e => e.entityId === prospect.id) && s.isLegallySignificant
    );
    if (!signals.length) continue;

    if (!hasAmbientLLMAccess()) {
      // Heuristic fallback: regex pick from first signal. One opp per prospect.
      const pick = pickServiceFromSignal(signals[0]);
      if (!pick) continue;
      const opp = await buildOpportunity({
        entity: prospect, signals: signals.slice(0, 5), service: pick.service,
        engineSource: 'prospect_discovery', matters: []
      });
      if (opp) { opp.notes = 'PROSPECT — review for solicitation compliance before outreach.'; opps.push(opp); }
      continue;
    }

    // LLM prospect screener — proposes up to 3 distinct service candidates,
    // each tied to specific signal indices. Replaces the regex picker which
    // produced one (often-wrong) service per prospect and dropped 80%+ at
    // composer self-flag.
    process.stdout.write(`[bake] prospect-screen: ${prospect.legalName}… `);
    let screenResult;
    try {
      screenResult = await screenProspect({ prospect, signals: signals.slice(0, 8) });
    } catch (err) {
      process.stdout.write(`screen-fail (${err.message?.slice(0, 60)})\n`);
      continue;
    }
    const candidates = screenResult.candidates || [];
    process.stdout.write(`${candidates.length} candidate(s)\n`);
    if (!candidates.length) continue;

    for (const cand of candidates) {
      // Pull the specific signal subset the candidate cited.
      const candSignals = cand.signalIndices
        .map(i => signals[i])
        .filter(Boolean)
        .slice(0, 5);
      if (!candSignals.length) continue;
      const opp = await buildOpportunity({
        entity: prospect,
        signals: candSignals,
        service: cand.service,
        engineSource: 'prospect_discovery',
        matters: []
      });
      if (!opp || seenOppIds.has(opp.id)) continue;
      opp.notes = 'PROSPECT — review for solicitation compliance before outreach.';
      seenOppIds.add(opp.id);
      opps.push(opp);
      audit({
        type: 'engine_run',
        actor: 'prospect_discovery_llm',
        inputs: { prospectId: prospect.id, signalIds: candSignals.map(s => s.id) },
        outputs: { service: cand.service, signalCount: candSignals.length, screenConfidence: cand.confidence }
      });
    }
  }
  return opps;
}

function sectorDefaultService(sector) {
  const map = {
    oil_gas: { service: 'force_majeure_advisory', practiceArea: 'litigation_disputes' },
    automotive: { service: 'product_liability', practiceArea: 'litigation_disputes' },
    defense_aerospace: { service: 'export_controls', practiceArea: 'sanctions_trade' },
    commodities: { service: 'ofac_advisory', practiceArea: 'sanctions_trade' },
    technology: { service: 'ai_regulation_advisory', practiceArea: 'regulatory_compliance' },
    fintech: { service: 'financial_services_regulation', practiceArea: 'regulatory_compliance' }
  };
  return map[sector] || null;
}

async function generateBriefings(workspace, opportunities, audit) {
  // Brief every surviving opp up to a generous cap. Raised from 14 → 30
  // so partners viewing the detail page never fall back to the heuristic
  // briefing for any non-trivial bake.
  const top = [...opportunities].sort((a, b) => b.score - a.score).slice(0, 30);
  const briefings = [];
  for (const opp of top) {
    const briefing = await buildBriefingPolished(workspace, opp);
    briefings.push(briefing);
    audit({
      type: 'briefing_generation',
      actor: hasAmbientLLMAccess() ? 'briefing_llm' : 'briefing_heuristic',
      inputs: { opportunityId: opp.id },
      outputs: { briefingId: briefing.id }
    });
  }
  return briefings;
}

function generateExampleChatHistory(workspace) {
  const topOpp = (workspace.opportunities || [])[0];
  if (!topOpp) return [];
  const entity = [...workspace.clients, ...workspace.prospects].find(e => e.id === topOpp.entity);
  return [
    {
      id: 'chat-seed-1u',
      role: 'user',
      content: 'Why is the top opportunity flagged as immediate?',
      timestamp: nowIso(),
      workspaceId: workspace.id
    },
    {
      id: 'chat-seed-1a',
      role: 'assistant',
      content: `Opportunity ${topOpp.id} (${entity?.legalName || 'entity'}, ${topOpp.suggestedService.replace(/_/g, ' ')}) is rated **${topOpp.urgencyTier}** because the source signal is recent and the engine identified a direct legal need.\n\nClick into the briefing for the full basis and cited sources.`,
      citations: [{ ref: topOpp.id }],
      timestamp: nowIso(),
      workspaceId: workspace.id
    }
  ];
}

async function main() {
  console.log('[bake] LegalPulse demo bake starting…');
  // Surface which provider the bake will use so the operator can confirm
  // they set the right env var. detectBakeProvider precedence:
  // ANTHROPIC_API_KEY → OPENAI_API_KEY → DEEPSEEK_API_KEY.
  const bakeProvider = detectBakeProvider();
  if (bakeProvider) {
    console.log(`[bake] LLM provider: ${bakeProvider.provider} (key ends ${String(bakeProvider.apiKey).slice(-8)})`);
  } else {
    console.log('[bake] LLM provider: NONE — heuristic-only bake. Set ANTHROPIC_API_KEY / OPENAI_API_KEY / DEEPSEEK_API_KEY to enable LLM agents.');
  }
  const startedAt = Date.now();
  resetUsage(); // Fresh cost counter per bake.
  const firmProfile = readSeed('firm-profile.json');
  const partners = readSeed('partners.json');
  const serviceTaxonomy = readSeed('service-taxonomy.json');
  const clients = readSeed('clients.json');
  const prospects = readSeed('prospects.json');
  const matters = readSeed('matters.json');
  const conflicts = readSeed('conflicts.json').conflicts;

  const workspace = {
    id: 'bake-snapshot',
    firmProfile,
    partners,
    serviceTaxonomy,
    clients,
    prospects,
    matters,
    conflicts,
    signals: [],
    opportunities: [],
    briefings: [],
    auditTrail: [],
    chatHistory: []
  };
  const audit = entry => addAuditEntry(workspace, entry);

  const sinceDate = (() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  })();

  const opts = {
    sinceDate,
    gdeltEntities: parseInt(process.env.BAKE_GDELT_ENTITIES || '0', 10) || (clients.length + prospects.length),
    maxThemes: parseInt(process.env.BAKE_MAX_THEMES || '0', 10) || THEMES_TO_FETCH.length
  };

  let perSource = {};
  let signals = [];
  if (process.env.BAKE_SKIP_FETCH === '1') {
    console.log('[bake] BAKE_SKIP_FETCH=1 — skipping external fetch; using synthetic signals only');
    signals = buildSyntheticSignals(clients, prospects);
    perSource = { synthetic: signals.length };
  } else {
    try {
      const ingest = await ingestRound(clients, prospects, opts);
      signals = ingest.allSignals;
      perSource = ingest.perSource;
    } catch (err) {
      console.warn(`[bake] external fetch failed wholesale: ${err.message}; falling back to synthetic signals`);
      signals = buildSyntheticSignals(clients, prospects);
      perSource = { synthetic: signals.length };
    }
    if (!signals.length) {
      console.warn('[bake] no external signals returned — adding synthetic signals so the demo is not empty');
      signals = buildSyntheticSignals(clients, prospects);
      perSource.synthetic = signals.length;
    }
  }

  audit({ type: 'ingestion', actor: 'bake', outputs: { perSource, total: signals.length } });

  const beforeDedup = signals.length;
  signals = deduplicateSignals(signals);
  workspace.signals = signals;
  audit({ type: 'ingestion', actor: 'bake_dedupe', outputs: { beforeDedup, afterDedup: signals.length } });

  const significantCount = await classifyAllSignals(workspace.signals, audit);
  console.log(`[bake] classified ${workspace.signals.length} signals; ${significantCount} legally significant`);

  // Cross-source fusion: annotate signals with cluster size / source-count so
  // the opportunity composer treats multi-source corroborated events as
  // stronger evidence than single-source isolated mentions.
  annotateFusion(workspace.signals);
  const fusedClusters = workspace.signals.filter(s => s.fusionGroupSize > 1);
  console.log(`[bake] signal fusion: ${fusedClusters.length} signals in multi-source clusters`);

  console.log(`[bake] generating opportunities (LLM ${hasAmbientLLMAccess() ? 'on' : 'off'})…`);
  const eventOpps = await generateEventDrivenOpportunities(workspace, audit);
  // NEW: auto-discover new-prospect entities from top event clusters. The
  // marketScreeningAgent will return entityRef.newProspect candidates that
  // we promote to first-class workspace.prospects + opportunities — gives
  // the demo a steady stream of "newly-discovered targets" each bake.
  const discoveredProspectOpps = await discoverNewProspectsFromEvents(workspace, audit);
  const crossSellOpps = await generateCrossSellOpportunities(workspace, audit);
  const prospectOpps = await generateProspectOpportunities(workspace, audit);

  // Engine-level dedup. Different engines (cross_sell, event_intelligence,
  // prospect_discovery) can independently surface the same (entityId,
  // service) combination with different signal sets — they get different
  // IDs (signal IDs are part of the opp ID hash) so the original simple
  // `[...allEngines]` concat let both reach the partner-facing card.
  // Collapse by (entityId, service) keeping the higher-scored opp; merge
  // the loser's signalIds + matterReferences so neither is lost.
  let engineDedupDropped = 0;
  const oppsByKey = new Map();
  function rankOpp(o) {
    const score = typeof o.score === 'number' ? o.score : 0;
    // Tie-breaker by engine priority — event-intelligence has the
    // strongest evidence type when an event actually fired, then
    // cross-sell (structural), then prospect/auto.
    const enginePriority = ({ event_intelligence: 3, cross_sell: 2, prospect_discovery: 1 }[o.engineSource] || 0);
    return score * 100 + enginePriority;
  }
  for (const o of [...eventOpps, ...crossSellOpps, ...prospectOpps, ...discoveredProspectOpps]) {
    if (!o) continue;
    const key = `${o.entity}::${o.suggestedService}`;
    const incumbent = oppsByKey.get(key);
    if (!incumbent) {
      oppsByKey.set(key, o);
      continue;
    }
    engineDedupDropped++;
    const winner = rankOpp(o) > rankOpp(incumbent) ? o : incumbent;
    const loser = winner === o ? incumbent : o;
    const mergedSignalIds = Array.from(new Set([
      ...(winner.basis?.signalIds || []),
      ...(loser.basis?.signalIds || [])
    ]));
    const mergedMatterRefs = Array.from(new Set([
      ...(winner.basis?.matterReferences || []),
      ...(loser.basis?.matterReferences || [])
    ]));
    winner.basis = {
      ...winner.basis,
      signalIds: mergedSignalIds,
      matterReferences: mergedMatterRefs
    };
    // Recompute opp.id so it stays consistent with its content. opp IDs are
    // hashed on (engine, entity, service, sortedSignalIds) per lib/ids.js,
    // so the merged signalIds list demands a fresh hash. Without this, the
    // surviving opp keeps its stale ID and downstream dedup checks
    // (e.g. seenOppIds.has(opp.id)) can let through what should be duplicates.
    winner.id = opportunityId(winner.engineSource, winner.entity, winner.suggestedService, mergedSignalIds);
    oppsByKey.set(key, winner);
  }
  workspace.opportunities = Array.from(oppsByKey.values());
  console.log(`[bake] opportunities: cross-sell=${crossSellOpps.length}, prospects=${prospectOpps.length}, event=${eventOpps.length}, auto-discovered=${discoveredProspectOpps.length}, after-engine-dedup=${workspace.opportunities.length} (collapsed ${engineDedupDropped})`);
  if (hasAmbientLLMAccess()) {
    console.log(`[bake] llm-compose summary: ${llmComposeCtr - llmComposeFailures}/${llmComposeCtr} succeeded (${llmComposeFailures} fallback)`);
    console.log(`[bake] pre-LLM filter: ${preFilteredSanctions} sanctions-only opps dropped (compliance, not BD)`);
    console.log(`[bake] quality gate: ${criticPassed} passed, ${criticDropped} dropped`);
  }

  console.log(`[bake] generating briefings (LLM ${hasAmbientLLMAccess() ? 'on' : 'off'})…`);
  workspace.briefings = await generateBriefings(workspace, workspace.opportunities, audit);
  if (hasAmbientLLMAccess()) {
    console.log(`[bake] llm-brief summary: ${llmBriefCtr - llmBriefFailures}/${llmBriefCtr} succeeded (${llmBriefFailures} fallback)`);
  }
  console.log(`[bake] briefings: ${workspace.briefings.length}`);

  workspace.chatHistory = generateExampleChatHistory(workspace);

  // Per-source contribution telemetry. The perSource map records INGESTED
  // counts; this adds two derived views: (a) how many signals from each
  // source were classified as legally significant, and (b) how many
  // surviving opportunities trace at least one cited signal back to each
  // source. Together they show which sources are actually moving the
  // needle, which would otherwise be invisible.
  const significantBySource = {};
  for (const s of workspace.signals) {
    if (!s.isLegallySignificant) continue;
    significantBySource[s.source] = (significantBySource[s.source] || 0) + 1;
  }
  const oppContribBySource = {};
  const signalById = new Map(workspace.signals.map(s => [s.id, s]));
  for (const o of workspace.opportunities) {
    const cited = (o.basis?.signalIds || []).map(id => signalById.get(id)).filter(Boolean);
    const sources = new Set(cited.map(s => s.source));
    for (const src of sources) {
      oppContribBySource[src] = (oppContribBySource[src] || 0) + 1;
    }
  }
  // Silent sources: configured + non-zero rate-limit slot in http.js, but
  // returned 0 signals for this bake. Flag in summary so it's actionable.
  const silentSources = Object.entries(perSource)
    .filter(([_, count]) => count === 0)
    .map(([src]) => src);

  const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
  const summary = {
    bakedAt: nowIso(),
    bakedBy: 'coding-agent-build-conversation',
    mode: hasAmbientLLMAccess() ? 'online-hybrid' : 'offline-heuristic',
    llmCompose: { total: llmComposeCtr, failures: llmComposeFailures },
    llmBrief: { total: llmBriefCtr, failures: llmBriefFailures },
    qualityGate: { dropped: criticDropped, demoted: criticDemoted, passed: criticPassed, preFilteredSanctions },
    engineDedup: { collapsed: engineDedupDropped, final: workspace.opportunities.length },
    eventScreener: { clustersScreened: eventClustersScreened, skipped: eventScreenerSkipped },
    autoProspectDiscovery: { clustersScreened: autoProspectClustersScreened, prospectsDiscovered: autoProspectsDiscovered },
    apiUsage: getUsageReport(),
    seedFirm: firmProfile.name,
    signalsIngested: beforeDedup,
    signalsAfterDedup: workspace.signals.length,
    signalsClassifiedAsLegallySignificant: significantCount,
    opportunitiesGenerated: {
      crossSell: crossSellOpps.length,
      prospects: prospectOpps.length,
      eventDriven: eventOpps.length
    },
    briefingsGenerated: workspace.briefings.length,
    auditEntries: workspace.auditTrail.length,
    durationSeconds,
    perSource,
    perSourceSignificant: significantBySource,
    perSourceContributedToOpps: oppContribBySource,
    silentSources,
    topEventScenarios: workspace.opportunities
      .filter(o => o.engineSource === 'event_intelligence')
      .slice(0, 5)
      .map(o => o.basis?.summary)
  };

  const snapshot = {
    bakedAt: summary.bakedAt,
    // Persist clients + prospects so auto-discovered entities (added by the
    // discoverNewProspectsFromEvents phase) survive a snapshot reload. The
    // seed JSONs are the floor; the snapshot is authoritative for any
    // entity whose discoverySource is 'auto_event_screening' or
    // 'market_screening'. Without this, workspace.opportunities reference
    // entity IDs that don't exist in the workspace state on reload, and
    // the OppCard renders the raw ID like "pr-screen-..." instead of the
    // legalName.
    clients: workspace.clients,
    prospects: workspace.prospects,
    signals: workspace.signals,
    opportunities: workspace.opportunities,
    briefings: workspace.briefings,
    auditTrail: workspace.auditTrail,
    chatHistory: workspace.chatHistory
  };

  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'demo-snapshot.json'), JSON.stringify(snapshot, null, 2));
  fs.writeFileSync(path.join(dataDir, 'bake-summary.json'), JSON.stringify(summary, null, 2));
  console.log(`[bake] wrote data/demo-snapshot.json (${(JSON.stringify(snapshot).length / 1024).toFixed(1)} KB)`);
  if (hasAmbientLLMAccess()) {
    const u = summary.apiUsage;
    console.log(`[bake] LLM usage: ${u.calls} calls, ${u.inputTokens.toLocaleString()} in / ${u.outputTokens.toLocaleString()} out tokens, est cost $${u.estimatedCostUsd.toFixed(3)}`);
  }
  console.log(`[bake] summary:\n${JSON.stringify(summary, null, 2)}`);
}

function buildSyntheticSignals(clients, prospects) {
  // Realistic, plausibly-current signals seeded against the named clients/prospects
  // so the demo isn't empty if all external fetches fail. Not used when real data
  // is available.
  const today = new Date().toISOString().slice(0, 10);
  const seeds = [
    { entity: 'BP plc', entityId: 'c-bp', source: 'gdelt', title: 'BP suspends Strait of Hormuz transits amid escalating Iran tensions', desc: 'Reuters reports BP has paused tanker transits through the Strait of Hormuz after Iranian Revolutionary Guard activity intensified. Charter contracts under review.', url: 'https://www.reuters.com/business/energy/bp-hormuz-pause' },
    { entity: 'A.P. Moller-Maersk A/S', entityId: 'c-maersk', source: 'gdelt', title: 'Maersk extends Red Sea diversions; force majeure notices issued to major shippers', desc: 'Maersk has issued force majeure notices to customers as Red Sea diversions continue.', url: 'https://www.maersk.com/press/red-sea-diversions' },
    { entity: 'Exxon Mobil Corporation', entityId: 'c-exxon', source: 'edgar', title: '8-K filing — material climate disclosure update', desc: 'ExxonMobil filed an 8-K describing accelerated climate disclosure obligations.', url: 'https://www.sec.gov/Archives/edgar/data/34088/000003408825000045/0000034088-25-000045-index.htm' },
    { entity: 'HSBC Holdings plc', entityId: 'c-hsbc', source: 'fca', title: 'FCA opens enforcement investigation into HSBC over historic AML controls', desc: 'The FCA confirmed an investigation into HSBC over deficiencies in 2020-2023 AML controls.', url: 'https://www.fca.org.uk/news/press-releases/hsbc-aml-investigation' },
    { entity: 'Microsoft Corporation', entityId: 'c-msft', source: 'dg_comp', title: 'EU DG COMP intensifies cloud bundling probe into Microsoft', desc: 'European Commission has requested additional information from Microsoft over Teams/Office cloud bundling.', url: 'https://ec.europa.eu/commission/presscorner/microsoft-cloud-probe' },
    { entity: 'Volkswagen AG', entityId: 'c-vw', source: 'doj', title: 'DOJ opens new investigation into VW emissions reporting in heavy-duty segment', desc: 'The DOJ has opened a fresh inquiry into VW heavy-duty emissions compliance.', url: 'https://www.justice.gov/opa/pr/vw-emissions-investigation' },
    { entity: 'ASML Holding NV', entityId: 'c-asml', source: 'federal_register', title: 'BIS issues updated export controls covering DUV lithography to PRC entities', desc: 'New US export controls expand restrictions on DUV lithography equipment to identified PRC entities.', url: 'https://www.federalregister.gov/documents/bis-duv-controls' },
    { entity: 'Boeing Co', entityId: 'c-boeing', source: 'courtlistener', title: 'Securities class action filed against Boeing over 737 MAX production guidance', desc: 'New putative class action filed in SDNY alleging misleading statements on 737 MAX production rate.', url: 'https://www.courtlistener.com/docket/boeing-737-max-class' },
    { entity: 'Pfizer Inc.', entityId: 'c-pfizer', source: 'courtlistener', title: 'Patent infringement complaint filed against Pfizer over Comirnaty', desc: 'Moderna filed patent infringement complaint against Pfizer covering Comirnaty lipid nanoparticle technology.', url: 'https://www.courtlistener.com/docket/moderna-pfizer-comirnaty' },
    { entity: 'JPMorgan Chase & Co.', entityId: 'c-jpm', source: 'fca', title: 'FCA opens wholesale markets review covering JPMorgan fixed-income desk', desc: 'FCA has initiated a review of fixed-income desk supervision practices at major banks including JPMorgan.', url: 'https://www.fca.org.uk/news/fixed-income-desk-review' },
    { entity: 'Goldman Sachs Group', entityId: 'c-gs', source: 'edgar', title: '8-K — Goldman Sachs discloses CFPB consumer-credit consent order', desc: 'Goldman disclosed a CFPB consent order over Apple Card consumer credit practices.', url: 'https://www.sec.gov/Archives/edgar/data/886982/000008869825000022/0000886982-25-000022-index.htm' },
    { entity: 'Vodafone Group plc', entityId: 'c-vodafone', source: 'dg_comp', title: 'EU DG COMP issues Statement of Objections in mobile pricing inquiry', desc: 'The European Commission has issued objections in a probe touching Vodafone and other operators.', url: 'https://ec.europa.eu/commission/presscorner/eu-mobile-pricing' },
    { entity: 'Saudi Aramco', entityId: 'pr-aramco', source: 'gdelt', title: 'Saudi Aramco signs joint venture with European refining group; antitrust review expected', desc: 'Aramco announced a JV touching European refining assets; multi-jurisdictional clearance expected.', url: 'https://www.aramco.com/news/jv-european-refining' },
    { entity: 'TotalEnergies SE', entityId: 'pr-total', source: 'courtlistener', title: 'Dutch climate plaintiffs file new claim against TotalEnergies', desc: 'New climate litigation filed in Netherlands court against TotalEnergies.', url: 'https://www.courtlistener.com/docket/totalenergies-climate-nl' },
    { entity: 'Anthropic, PBC', entityId: 'pr-anthropic', source: 'gdelt', title: 'Anthropic announces EU enterprise expansion as AI Act enforcement begins', desc: 'Anthropic is expanding EU enterprise contracts, coinciding with AI Act enforcement activity.', url: 'https://www.anthropic.com/news/eu-enterprise' },
    { entity: 'Glencore plc', entityId: 'pr-glencore', source: 'doj', title: 'DOJ presses follow-on FCPA proceedings against Glencore subsidiary', desc: 'Follow-on FCPA proceedings continue affecting a Glencore subsidiary in Africa.', url: 'https://www.justice.gov/opa/pr/glencore-fcpa-followon' },
    { entity: 'BAE Systems plc', entityId: 'pr-bae', source: 'gdelt', title: 'BAE Systems wins £1.2bn UK defense contract; export licence preparation underway', desc: 'BAE Systems announced a major UK defense contract requiring export licence work for international partners.', url: 'https://www.baesystems.com/news/uk-1bn-contract' },
    { entity: 'Wise plc', entityId: 'pr-wise', source: 'fca', title: 'FCA confirms Wise compliance audit; consumer protection focus', desc: 'FCA has confirmed a compliance audit covering Wise consumer protection processes.', url: 'https://www.fca.org.uk/news/wise-audit' },
    { entity: 'Stellantis NV', entityId: 'pr-stellantis', source: 'gdelt', title: 'Stellantis recalls 1.5M vehicles in US over ABS defect; class actions likely', desc: 'Stellantis announced a 1.5M-vehicle US recall; product liability litigation anticipated.', url: 'https://www.stellantis.com/news/us-recall-2025' },
    { entity: 'Lockheed Martin Corp', entityId: 'pr-lockheed', source: 'federal_register', title: 'BIS updates export licensing for AUKUS partner deliveries — Lockheed cited', desc: 'BIS published an updated export licensing framework for AUKUS deliveries mentioning Lockheed Martin programmes.', url: 'https://www.federalregister.gov/documents/bis-aukus-export-update' }
  ];
  return seeds.map((s, i) => ({
    id: `sig-synthetic-${i.toString(16).padStart(12, '0')}`,
    source: s.source,
    sourceUrl: s.url,
    ingestionTimestamp: nowIso(),
    publishedAt: today,
    title: s.title,
    description: s.desc,
    entities: [{ entityType: s.entityId.startsWith('pr-') ? 'prospect' : 'client', entityId: s.entityId, mentionedAs: s.entity, confidence: 0.95 }],
    jurisdictions: [],
    rawMetadata: { synthetic: true }
  }));
}

main().catch(err => {
  console.error('[bake] fatal:', err);
  process.exit(1);
});
