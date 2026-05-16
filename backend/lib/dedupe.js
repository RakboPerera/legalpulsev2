import { createHash } from 'crypto';

function normalizeTitle(t) {
  return (t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function dayBucket(iso) {
  if (!iso) return '0000-00-00';
  return iso.slice(0, 10);
}

function entityKey(entities = []) {
  return (entities[0]?.entityId || entities[0]?.mentionedAs || 'unknown').toLowerCase();
}

function fingerprint(signal) {
  const title = normalizeTitle(signal.title).slice(0, 100);
  const entity = entityKey(signal.entities);
  const day = dayBucket(signal.publishedAt);
  const h = createHash('sha1').update(`${entity}|${day}|${title}`).digest('hex').slice(0, 16);
  return h;
}

// Second-pass fingerprint that ignores entity. Catches the cross-source
// case where Tavily and GDELT both fetch the same article via different
// per-entity queries — same title, same day, but different entityKey on
// each fetch. Title-only fingerprint collapses them.
function titleDayFingerprint(signal) {
  const title = normalizeTitle(signal.title).slice(0, 120);
  if (!title) return null; // can't dedupe empty titles
  const day = dayBucket(signal.publishedAt);
  const h = createHash('sha1').update(`${day}|${title}`).digest('hex').slice(0, 16);
  return h;
}

// Pick the "richer" of two same-content signals. Preference order:
// 1. Has description (vs title-only)
// 2. Longer description
// 3. More recent ingestion
function pickRicher(a, b) {
  const aHasDesc = (a.description || '').length;
  const bHasDesc = (b.description || '').length;
  if (aHasDesc !== bHasDesc) return aHasDesc > bHasDesc ? a : b;
  const aIng = a.ingestionTimestamp || '';
  const bIng = b.ingestionTimestamp || '';
  return aIng >= bIng ? a : b;
}

// Sources whose signal.id is hashed on an authoritative resource URL
// (SEC accession, Companies House transaction id, CourtListener docket).
// Same-ID dedup already collapses true dupes; the title-based fingerprint
// would over-collapse legitimately distinct same-day filings ("6-K filing
// — HSBC Holdings plc" filed multiple times in a day with different
// accessions).
const STRUCTURAL_SOURCES = new Set(['edgar', 'companies_house', 'courtlistener']);

export function deduplicateSignals(signals) {
  // Pass 0: same-ID collapse (catches exact re-fetches across runs / themes).
  const byId = new Map();
  for (const sig of signals) {
    if (!byId.has(sig.id)) byId.set(sig.id, sig);
  }

  // Pass 1: entity+day+title fingerprint — for NEWS-LIKE sources only.
  // Structural sources skip pass 1 because their signal.id is already
  // authoritative and title may collide across distinct filings.
  const seen = new Map();
  for (const sig of byId.values()) {
    if (STRUCTURAL_SOURCES.has(sig.source)) {
      // Pass through with a unique key.
      seen.set(`__id__${sig.id}`, sig);
      continue;
    }
    const fp = fingerprint(sig);
    if (!seen.has(fp)) {
      seen.set(fp, sig);
    } else {
      const existing = seen.get(fp);
      if (!existing.entities?.length && sig.entities?.length) {
        seen.set(fp, { ...sig, id: existing.id });
      }
    }
  }

  // Pass 2: title-only fingerprint catches cross-source dupes that pass 1
  // missed because each fetcher tagged a different entityKey. We keep the
  // richer record; the dropped record's entity tags merge into the keeper
  // so both perspectives are preserved.
  //
  // Scope: news-style sources only (tavily, gdelt, RSS). EDGAR / Companies
  // House / CourtListener produce same-title-same-day records for distinct
  // underlying filings (e.g. multiple "6-K filing — HSBC Holdings plc" on
  // the same date for different attachments) and must NOT be collapsed.
  const NEWS_LIKE = new Set([
    'tavily', 'gdelt',
    'fca', 'cma', 'fca_govuk', 'ico_govuk', 'ofcom', 'bank_of_england', 'hmt',
    'doj', 'ftc', 'cftc', 'dg_comp', 'federal_register',
    'lexology', 'jd_supra', 'fda_warning_letters'
  ]);
  const byTitleDay = new Map();
  for (const sig of seen.values()) {
    const tfp = titleDayFingerprint(sig);
    if (!tfp || !NEWS_LIKE.has(sig.source)) {
      // Untitled OR structural-source: keep with a unique key.
      byTitleDay.set(`__keep__${sig.id}`, sig);
      continue;
    }
    if (!byTitleDay.has(tfp)) {
      byTitleDay.set(tfp, sig);
    } else {
      const existing = byTitleDay.get(tfp);
      const keeper = pickRicher(existing, sig);
      const loser = keeper === existing ? sig : existing;
      // Merge entity tags from the loser into the keeper. Match by entityId
      // when present, else by mentionedAs (case-insensitive) so pre-link
      // tags from sources like Tavily (which carry mentionedAs but no
      // entityId until deepLinkEntities runs) are preserved instead of
      // silently dropped — they're the only attribution we have for some
      // theme-query signals.
      const mergedEntities = [...(keeper.entities || [])];
      for (const e of (loser.entities || [])) {
        const dupe = mergedEntities.some(x => {
          if (e.entityId && x.entityId) return e.entityId === x.entityId;
          if (e.mentionedAs && x.mentionedAs) {
            return e.mentionedAs.toLowerCase() === x.mentionedAs.toLowerCase();
          }
          return false;
        });
        if (!dupe) mergedEntities.push(e);
      }
      byTitleDay.set(tfp, { ...keeper, entities: mergedEntities });
    }
  }
  return Array.from(byTitleDay.values());
}
