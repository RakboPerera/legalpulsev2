import { fetchExternal } from '../lib/http.js';
import { signalId } from '../lib/ids.js';

export async function fetchFederalRegisterRecent({ sinceDate, perPage = 20 } = {}) {
  const params = new URLSearchParams();
  params.set('per_page', String(perPage));
  params.set('order', 'newest');
  if (sinceDate) params.set('conditions[publication_date][gte]', sinceDate);
  const url = `https://www.federalregister.gov/api/v1/documents.json?${params.toString()}`;
  const data = await fetchExternal({ source: 'federal_register', url, responseType: 'json', maxRetries: 2 });
  if (!data || !Array.isArray(data.results)) return [];
  return data.results.map(d => ({
    id: signalId('us_federal', 'federal_register', d.html_url || d.pdf_url || d.document_number, d.publication_date),
    source: 'federal_register',
    sourceUrl: d.html_url || d.pdf_url,
    ingestionTimestamp: new Date().toISOString(),
    publishedAt: d.publication_date,
    title: d.title || '(regulation)',
    description: d.abstract,
    entities: [],
    jurisdictions: ['USA'],
    rawMetadata: { agencies: (d.agencies || []).map(a => a.name), type: d.type }
  }));
}
