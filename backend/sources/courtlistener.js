import { fetchExternal } from '../lib/http.js';
import { signalId } from '../lib/ids.js';

export async function fetchCourtListenerForEntity(entityName, { sinceDate } = {}) {
  const token = process.env.COURTLISTENER_API_TOKEN;
  if (!token) {
    console.warn('[courtlistener] no API token; skipping');
    return [];
  }
  const params = new URLSearchParams();
  params.set('q', entityName);
  params.set('type', 'r');
  params.set('order_by', 'dateFiled desc');
  if (sinceDate) params.set('filed_after', sinceDate);
  const url = `https://www.courtlistener.com/api/rest/v4/search/?${params.toString()}`;
  const data = await fetchExternal({
    source: 'courtlistener',
    url,
    headers: { 'Authorization': `Token ${token}` },
    responseType: 'json',
    maxRetries: 2
  });
  if (!data || !Array.isArray(data.results)) return [];
  return data.results.slice(0, 20).map(r => {
    const link = r.absolute_url ? `https://www.courtlistener.com${r.absolute_url}` : (r.download_url || r.docket_absolute_url || '');
    return {
      id: signalId(entityName, 'courtlistener', link || r.caseName || r.docketNumber || '', r.dateFiled || r.dateArgued || ''),
      source: 'courtlistener',
      sourceUrl: link,
      ingestionTimestamp: new Date().toISOString(),
      publishedAt: r.dateFiled || new Date().toISOString(),
      title: r.caseName || '(case)',
      description: `${r.court || ''}${r.docketNumber ? ': ' + r.docketNumber : ''}`,
      // Intentionally empty — CourtListener's keyword search returns spurious
      // matches (e.g. "BP" matches unrelated cases). Letting deepLinkEntities
      // re-link via word-boundary regex on the case caption is the only way
      // to avoid false-positive entity attachments.
      entities: [],
      jurisdictions: ['USA'],
      rawMetadata: { court: r.court, docketNumber: r.docketNumber, suitNature: r.suitNature, queriedFor: entityName }
    };
  });
}
