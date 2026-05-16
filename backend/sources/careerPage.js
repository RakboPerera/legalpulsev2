import { load } from 'cheerio';
import { fetchExternal } from '../lib/http.js';
import { signalId } from '../lib/ids.js';

const KEYWORDS = ['General Counsel', 'Chief Compliance Officer', 'Head of Legal', 'Senior Legal Counsel', 'VP Legal', 'Deputy General Counsel'];

export async function scrapeCareerPage(entityName, url, jurisdiction) {
  const html = await fetchExternal({ source: 'career_page', url, responseType: 'text', maxRetries: 1 });
  if (!html) return [];
  const $ = load(html);
  const signals = [];
  $('a, h1, h2, h3, h4, li').each((_, el) => {
    const text = $(el).text().trim();
    if (!text || text.length > 300) return;
    if (KEYWORDS.some(k => text.toLowerCase().includes(k.toLowerCase()))) {
      signals.push({
        id: signalId(entityName, 'career_page', url + '#' + text, new Date().toISOString().slice(0,10)),
        source: 'career_page',
        sourceUrl: url,
        ingestionTimestamp: new Date().toISOString(),
        publishedAt: new Date().toISOString(),
        title: `Legal hiring signal — ${text}`,
        description: undefined,
        entities: [{ entityType: 'unknown', mentionedAs: entityName, confidence: 1.0 }],
        jurisdictions: jurisdiction ? [jurisdiction] : [],
        rawMetadata: { match: text }
      });
    }
  });
  return signals.slice(0, 5);
}
