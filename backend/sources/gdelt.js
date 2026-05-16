import { fetchExternal } from '../lib/http.js';
import { signalId } from '../lib/ids.js';

function normaliseGdeltDate(d) {
  if (!d || typeof d !== 'string') return new Date().toISOString();
  // GDELT seendate is "YYYYMMDDTHHMMSSZ"
  if (/^\d{8}T\d{6}Z$/.test(d)) {
    return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${d.slice(9,11)}:${d.slice(11,13)}:${d.slice(13,15)}Z`;
  }
  return d;
}

export async function fetchGdeltSignalsForEntity(entityName, { timespan = '7d', maxRecords = 25 } = {}) {
  const query = `"${entityName}"`;
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=${maxRecords}&format=json&timespan=${timespan}`;
  const data = await fetchExternal({ source: 'gdelt', url, responseType: 'json', maxRetries: 2 });
  if (!data || !Array.isArray(data.articles)) return [];
  return data.articles.map(a => {
    const publishedAt = normaliseGdeltDate(a.seendate);
    return {
      id: signalId(entityName, 'gdelt', a.url, publishedAt),
      source: 'gdelt',
      sourceUrl: a.url,
      ingestionTimestamp: new Date().toISOString(),
      publishedAt,
      title: a.title || '(untitled)',
      description: undefined,
      entities: [{ entityType: 'unknown', mentionedAs: entityName, confidence: 0.9 }],
      jurisdictions: a.sourcecountry ? [a.sourcecountry] : [],
      rawMetadata: { domain: a.domain, language: a.language, tone: a.tone }
    };
  });
}

export async function fetchGdeltSignalsForTheme(theme, { timespan = '3d', maxRecords = 25 } = {}) {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(theme)}&mode=artlist&maxrecords=${maxRecords}&format=json&timespan=${timespan}`;
  const data = await fetchExternal({ source: 'gdelt', url, responseType: 'json', maxRetries: 2 });
  if (!data || !Array.isArray(data.articles)) return [];
  return data.articles.map(a => {
    const publishedAt = normaliseGdeltDate(a.seendate);
    return {
      id: signalId(theme, 'gdelt', a.url, publishedAt),
      source: 'gdelt',
      sourceUrl: a.url,
      ingestionTimestamp: new Date().toISOString(),
      publishedAt,
      title: a.title || '(untitled)',
      description: undefined,
      entities: [],
      jurisdictions: a.sourcecountry ? [a.sourcecountry] : [],
      rawMetadata: { domain: a.domain, language: a.language, tone: a.tone, theme }
    };
  });
}
