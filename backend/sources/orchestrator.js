import { fetchGdeltSignalsForEntity, fetchGdeltSignalsForTheme } from './gdelt.js';
import { fetchEdgarFilings } from './edgar.js';
import { fetchCourtListenerForEntity } from './courtlistener.js';
import { fetchCompaniesHouseFilings, fetchCompaniesHouseOfficers } from './companiesHouse.js';
import { fetchFederalRegisterRecent } from './federalRegister.js';
import { fetchRssFeed } from './rssSources.js';
import { fetchOfacSdn, fetchUkOfsi, crossReferenceSanctions } from './sanctions.js';
import { fetchTavilySignalsForEntity, fetchTavilySignalsForTheme, hasTavilyAccess } from './tavily.js';
import { fetchFdaWarningLetters } from './fdaWarningLetters.js';
import { deduplicateSignals } from '../lib/dedupe.js';
import { linkEntities } from '../lib/entities.js';
import { addAuditEntry } from '../lib/audit.js';

// All RSS feeds the registry knows about. Kept in sync with rssSources.js#FEEDS
// — when a feed is added there, add it here too. The earlier hardcoded list
// of 6 silently dropped CMA, ICO, Ofcom, BoE, HMT, CFTC, and FCA-govuk.
const ALL_RSS_SOURCES = [
  'doj', 'ftc', 'cftc',
  'dg_comp',
  'fca', 'fca_govuk', 'cma', 'ico_govuk', 'ofcom', 'bank_of_england', 'hmt',
  'lexology', 'jd_supra'
];

const THEMES = [
  'Strait of Hormuz tanker',
  'Red Sea shipping disruption',
  'EU AI Act enforcement',
  'OFAC sanctions designation',
  'antitrust merger review',
  'force majeure shipping',
  'climate litigation oil major',
  'export controls semiconductors',
  'pharmaceutical patent litigation'
];

// Each source runs inside isolate() — a failure logs a warning + records the
// failure in perSourceErrors, but does NOT abort other sources or discard
// already-collected signals.
async function isolate(source, fn, perSourceErrors) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[ingest] ${source} failed: ${err.message}`);
    perSourceErrors[source] = (perSourceErrors[source] || 0) + 1;
    return [];
  }
}

// The pipeline runner passes `sourcesOverride` (an array of source IDs the
// user selected for this run) and an `onProgress` callback to stream live
// log lines back to the SSE client. Both are optional — when absent, the
// orchestrator reads from workspace.externalSourceConfig.enabledSources
// and runs silently as before.
export async function runIngestionForWorkspace({ workspace, limits = {}, sourcesOverride, onProgress } = {}) {
  const startedAt = Date.now();
  const enabled = new Set(
    Array.isArray(sourcesOverride)
      ? sourcesOverride
      : (workspace.externalSourceConfig?.enabledSources || [])
  );
  const targets = [...(workspace.clients || []), ...(workspace.prospects || [])];
  const log = (line) => { try { onProgress?.(line); } catch { /* never let logging break the run */ } };

  const sinceDate = (() => {
    const d = new Date(); d.setDate(d.getDate() - (limits.daysBack || 30));
    return d.toISOString().slice(0, 10);
  })();

  const perSource = {};
  const perSourceErrors = {};
  let collected = [];

  log(`[ingest] enabled sources: ${[...enabled].join(', ') || '(none)'} · roster: ${targets.length} entities`);

  // GDELT — per entity, limited
  if (enabled.has('gdelt')) {
    log('[ingest] gdelt: starting…');
    perSource.gdelt = 0;
    const limit = Math.min(targets.length, limits.gdeltEntities ?? targets.length);
    for (let i = 0; i < limit; i++) {
      const t = targets[i];
      const sigs = await isolate(`gdelt:${t.id}`, () => fetchGdeltSignalsForEntity(t.legalName, { timespan: limits.gdeltTimespan || '14d', maxRecords: limits.gdeltMaxRecords || 15 }), perSourceErrors);
      perSource.gdelt += sigs.length;
      collected.push(...sigs.map(s => ({ ...s, entities: [{ entityType: t.id.startsWith('pr-') ? 'prospect' : 'client', entityId: t.id, mentionedAs: t.legalName, confidence: 0.95 }] })));
    }
    for (const theme of (limits.themes || THEMES).slice(0, limits.maxThemes || THEMES.length)) {
      const sigs = await isolate(`gdelt:theme`, () => fetchGdeltSignalsForTheme(theme, { timespan: '7d', maxRecords: limits.gdeltMaxRecords || 10 }), perSourceErrors);
      perSource.gdelt += sigs.length;
      collected.push(...sigs);
    }
    log(`[ingest] gdelt: ${perSource.gdelt} signals`);
  }

  if (enabled.has('edgar')) {
    log('[ingest] edgar: starting…');
    perSource.edgar = 0;
    for (const t of targets) {
      const cik = t.externalIdentifiers?.secCik;
      if (!cik) continue;
      const sigs = await isolate(`edgar:${t.id}`, () => fetchEdgarFilings(cik, { sinceDate, entityName: t.legalName }), perSourceErrors);
      perSource.edgar += sigs.length;
      collected.push(...sigs.map(s => ({ ...s, entities: [{ entityType: t.id.startsWith('pr-') ? 'prospect' : 'client', entityId: t.id, mentionedAs: t.legalName, confidence: 1.0 }] })));
    }
    log(`[ingest] edgar: ${perSource.edgar} filings`);
  }

  if (enabled.has('courtlistener')) {
    log('[ingest] courtlistener: starting…');
    perSource.courtlistener = 0;
    for (const t of targets.slice(0, limits.courtListenerEntities ?? targets.length)) {
      const sigs = await isolate(`courtlistener:${t.id}`, () => fetchCourtListenerForEntity(t.legalName, { sinceDate }), perSourceErrors);
      perSource.courtlistener += sigs.length;
      collected.push(...sigs.map(s => ({ ...s, entities: [{ entityType: t.id.startsWith('pr-') ? 'prospect' : 'client', entityId: t.id, mentionedAs: t.legalName, confidence: 0.85 }] })));
    }
    log(`[ingest] courtlistener: ${perSource.courtlistener} cases`);
  }

  if (enabled.has('companies_house')) {
    perSource.companies_house = 0;
    for (const t of targets) {
      const num = t.externalIdentifiers?.companiesHouseNumber;
      if (!num) continue;
      const filings = await isolate(`ch:${t.id}:filings`, () => fetchCompaniesHouseFilings(num, { entityName: t.legalName }), perSourceErrors);
      const officers = await isolate(`ch:${t.id}:officers`, () => fetchCompaniesHouseOfficers(num, { entityName: t.legalName }), perSourceErrors);
      const combined = [...filings, ...officers];
      perSource.companies_house += combined.length;
      collected.push(...combined.map(s => ({ ...s, entities: [{ entityType: t.id.startsWith('pr-') ? 'prospect' : 'client', entityId: t.id, mentionedAs: t.legalName, confidence: 1.0 }] })));
    }
  }

  if (enabled.has('federal_register')) {
    const sigs = await isolate('federal_register', () => fetchFederalRegisterRecent({ sinceDate, perPage: 25 }), perSourceErrors);
    perSource.federal_register = sigs.length;
    collected.push(...sigs);
  }

  // Tavily — the primary news source for entity + theme coverage. Skipped
  // entirely when the API key is missing (the helper logs once). Was missing
  // from the orchestrator and is responsible for ~60% of the bake's signal
  // pool, so "refresh signals" was returning a tiny fraction without it.
  if (enabled.has('tavily') && hasTavilyAccess()) {
    log('[ingest] tavily: starting…');
    perSource.tavily = 0;
    const limit = Math.min(targets.length, limits.tavilyEntities ?? targets.length);
    for (let i = 0; i < limit; i++) {
      const t = targets[i];
      const sigs = await isolate(`tavily:${t.id}`, () => fetchTavilySignalsForEntity(t, { days: limits.tavilyDays || 14, maxRecords: limits.tavilyMaxRecords || 10 }), perSourceErrors);
      perSource.tavily += sigs.length;
      collected.push(...sigs.map(s => ({ ...s, entities: [{ entityType: t.id.startsWith('pr-') ? 'prospect' : 'client', entityId: t.id, mentionedAs: t.legalName, confidence: 0.85 }] })));
    }
    for (const theme of (limits.themes || THEMES).slice(0, limits.maxThemes || THEMES.length)) {
      const sigs = await isolate('tavily:theme', () => fetchTavilySignalsForTheme(theme, { days: 7, maxRecords: limits.tavilyMaxRecords || 8 }), perSourceErrors);
      perSource.tavily += sigs.length;
      collected.push(...sigs);
    }
    log(`[ingest] tavily: ${perSource.tavily} signals`);
  } else if (enabled.has('tavily')) {
    log('[ingest] tavily: SKIPPED (TAVILY_API_KEY not configured)');
  }

  if (enabled.has('fda_warning_letters')) {
    const sigs = await isolate('fda_warning_letters', () => fetchFdaWarningLetters({ maxRecords: limits.fdaMaxRecords || 30 }), perSourceErrors);
    perSource.fda_warning_letters = sigs.length;
    collected.push(...sigs);
  }

  for (const src of ALL_RSS_SOURCES) {
    if (!enabled.has(src)) continue;
    const sigs = await isolate(src, () => fetchRssFeed(src), perSourceErrors);
    perSource[src] = sigs.length;
    collected.push(...sigs);
  }

  if (enabled.has('ofac_sdn') || enabled.has('uk_ofsi')) {
    log('[ingest] sanctions: starting…');
    const names = targets.flatMap(t => [t.legalName, ...(t.knownAliases || [])]).filter(Boolean);
    const ofac = enabled.has('ofac_sdn') ? await isolate('ofac_sdn', () => fetchOfacSdn(), perSourceErrors) : [];
    const ukOfsi = enabled.has('uk_ofsi') ? await isolate('uk_ofsi', () => fetchUkOfsi(), perSourceErrors) : [];
    const sigs = crossReferenceSanctions(names, [...ofac, ...ukOfsi]);
    perSource.sanctions_cross_ref = sigs.length;
    collected.push(...sigs);
    log(`[ingest] sanctions: ${sigs.length} cross-ref hits`);
  }

  // Entity-link untagged signals (defensive — engine fetchers usually tag).
  for (const s of collected) {
    if (!s.entities?.some(e => e.entityId)) {
      const text = `${s.title || ''} ${s.description || ''}`;
      const links = linkEntities(text, workspace.clients || [], workspace.prospects || []);
      if (links.length) s.entities = links;
    }
  }

  const beforeDedup = collected.length;
  const deduped = deduplicateSignals(collected);
  workspace.signals = mergeSignals(workspace.signals || [], deduped);

  addAuditEntry(workspace, {
    type: 'ingestion',
    actor: 'ingestion_orchestrator',
    outputs: { perSource, perSourceErrors, beforeDedup, afterDedup: deduped.length, durationMs: Date.now() - startedAt }
  });

  return {
    totalSignals: deduped.length,
    beforeDedup,
    perSource,
    perSourceErrors,
    durationMs: Date.now() - startedAt
  };
}

function mergeSignals(existing, incoming) {
  const byId = new Map(existing.map(s => [s.id, s]));
  for (const s of incoming) {
    const prior = byId.get(s.id);
    if (!prior) { byId.set(s.id, s); continue; }
    // Don't let a fresh-from-fetcher signal with an empty `entities` array
    // clobber prior entity links that linkEntities resolved last time. Union
    // by entityId, keeping the higher-confidence record for each.
    const mergedEntities = unionEntities(prior.entities || [], s.entities || []);
    byId.set(s.id, { ...prior, ...s, entities: mergedEntities });
  }
  return Array.from(byId.values());
}

function unionEntities(a, b) {
  const out = new Map();
  for (const e of [...a, ...b]) {
    if (!e?.entityId) continue;
    const prev = out.get(e.entityId);
    if (!prev || (e.confidence || 0) > (prev.confidence || 0)) out.set(e.entityId, e);
  }
  return Array.from(out.values());
}
