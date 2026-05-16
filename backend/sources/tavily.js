// Tavily — purpose-built search/news API for AI agents. Used as the
// primary news-fetching source because GDELT's public API is unreliable
// under load (sustained timeouts and aborted requests during demo bakes).
//
// Two modes mirror the GDELT interface so the orchestrator can drop Tavily
// in either as primary or fallback:
//   - fetchTavilySignalsForEntity(entityName) — entity-specific news.
//   - fetchTavilySignalsForTheme(theme) — global theme news (no entity tag).
//
// Tavily's `news` topic returns recent articles only (up to N days back).
// Each result has a content excerpt — significantly richer than GDELT's
// title-only output, which feeds straight into the LLM composer/screener
// for better reasoning.

import { fetchExternal } from '../lib/http.js';
import { signalId } from '../lib/ids.js';

const TAVILY_URL = 'https://api.tavily.com/search';

function getApiKey() {
  return process.env.TAVILY_API_KEY || null;
}

async function tavilySearch({ query, topic = 'news', days = 14, maxResults = 10 }) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  const body = JSON.stringify({
    api_key: apiKey,
    query,
    topic,
    search_depth: 'basic',
    max_results: maxResults,
    include_answer: false,
    include_raw_content: false,
    // `days` only applies to topic=news. Tavily ignores it for general topic.
    ...(topic === 'news' ? { days } : {})
  });
  const data = await fetchExternal({
    source: 'tavily',
    url: TAVILY_URL,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    responseType: 'json',
    maxRetries: 1,
    timeoutMs: 25000
  });
  return data;
}

function normalisePublishedAt(s) {
  if (!s) return new Date().toISOString();
  // Tavily returns ISO 8601 strings or "YYYY-MM-DD". Both parse cleanly.
  const t = Date.parse(s);
  if (isNaN(t)) return new Date().toISOString();
  return new Date(t).toISOString();
}

// Build the Tavily query string. Accepts a string (legacy: just the legal
// name) or an object { legalName, aliases } so callers can pass curated
// short forms and the query OR-matches any of them. The previous "${name}"
// quoted-exact query missed real articles that referred to the entity only
// by its short alias (e.g. articles saying just "BP" never matched the
// query "BP plc"). Tavily quotation marks force exact-phrase matching, so
// keeping them on multi-token names but OR-joining short aliases gives
// recall without sacrificing precision.
function buildEntityQuery(target) {
  if (typeof target === 'string') target = { legalName: target, aliases: [] };
  const seen = new Set();
  const terms = [];
  const push = (name) => {
    if (!name || typeof name !== 'string') return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    // Multi-token names get quoted to keep exact-phrase precision; single-
    // token names (BP, HSBC, Maersk) stay unquoted so Tavily can match
    // possessives / declensions ("BP's", "Maersk's").
    terms.push(/\s/.test(trimmed) ? `"${trimmed}"` : trimmed);
  };
  push(target.legalName);
  for (const a of target.aliases || []) push(a);
  // Cap at 5 OR-terms — Tavily's relevance ranking degrades past that and
  // we don't want one ambiguous short form (e.g. "GS") to dominate the
  // result set when a longer canonical form would have been precise.
  return terms.slice(0, 5).join(' OR ') || (target.legalName || '');
}

export async function fetchTavilySignalsForEntity(target, { days = 14, maxRecords = 10 } = {}) {
  // Accept legacy string form; canonicalise to { legalName, aliases }.
  const entity = typeof target === 'string' ? { legalName: target, aliases: [] } : target;
  const entityName = entity.legalName;
  const query = buildEntityQuery(entity);
  const data = await tavilySearch({
    query,
    topic: 'news',
    days,
    maxResults: maxRecords
  });
  if (!data || !Array.isArray(data.results)) return [];
  return data.results.map(r => ({
    id: signalId(entityName, 'tavily', r.url, r.published_date || ''),
    source: 'tavily',
    sourceUrl: r.url,
    ingestionTimestamp: new Date().toISOString(),
    publishedAt: normalisePublishedAt(r.published_date),
    title: r.title || '(untitled)',
    description: (r.content || '').slice(0, 600),
    entities: [{ entityType: 'unknown', mentionedAs: entityName, confidence: 0.85 }],
    jurisdictions: [],
    rawMetadata: { score: r.score, query }
  }));
}

export async function fetchTavilySignalsForTheme(theme, { days = 7, maxRecords = 10 } = {}) {
  const data = await tavilySearch({
    query: theme,
    topic: 'news',
    days,
    maxResults: maxRecords
  });
  if (!data || !Array.isArray(data.results)) return [];
  return data.results.map(r => ({
    id: signalId(theme, 'tavily', r.url, r.published_date || ''),
    source: 'tavily',
    sourceUrl: r.url,
    ingestionTimestamp: new Date().toISOString(),
    publishedAt: normalisePublishedAt(r.published_date),
    title: r.title || '(untitled)',
    description: (r.content || '').slice(0, 600),
    // Theme queries don't pre-tag entities — let deep entity linking
    // recover real mentions from title + content.
    entities: [],
    jurisdictions: [],
    rawMetadata: { score: r.score, theme }
  }));
}

export function hasTavilyAccess() {
  return Boolean(getApiKey());
}
