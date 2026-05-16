import { fetchExternal } from '../lib/http.js';
import { signalId } from '../lib/ids.js';

const NOTABLE_FORMS = new Set(['8-K', 'S-4', 'S-1', '10-K', '10-Q', 'DEF 14A', 'SC 13D', 'SC 13G', '20-F', '6-K']);

export async function fetchEdgarFilings(cik, { sinceDate, entityName, includeAll = false } = {}) {
  if (!cik) return [];
  const padded = String(cik).padStart(10, '0');
  const url = `https://data.sec.gov/submissions/CIK${padded}.json`;
  const data = await fetchExternal({
    source: 'edgar',
    url,
    headers: { 'User-Agent': process.env.SEC_EDGAR_USER_AGENT || 'LegalPulse Demo (contact@example.com)' },
    responseType: 'json',
    cacheTtlMs: 1000 * 60 * 60
  });
  if (!data || !data.filings?.recent) return [];
  const recent = data.filings.recent;
  const signals = [];
  const name = entityName || data.name;
  for (let i = 0; i < (recent.accessionNumber || []).length; i++) {
    const filingDate = recent.filingDate?.[i];
    if (sinceDate && (!filingDate || filingDate < sinceDate)) continue;
    const form = recent.form[i];
    if (!includeAll && !NOTABLE_FORMS.has(form)) continue;
    const accessionNumber = (recent.accessionNumber[i] || '').replace(/-/g, '');
    const primaryDoc = (recent.primaryDocument || [])[i] || '';
    const filingUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accessionNumber}/${primaryDoc}`;
    signals.push({
      id: signalId(name, 'edgar', filingUrl, filingDate),
      source: 'edgar',
      sourceUrl: filingUrl,
      ingestionTimestamp: new Date().toISOString(),
      publishedAt: filingDate,
      title: `${form} filing — ${name}`,
      description: recent.primaryDocDescription?.[i] || undefined,
      entities: [{ entityType: 'unknown', mentionedAs: name, confidence: 1.0 }],
      jurisdictions: ['USA'],
      rawMetadata: { form, accessionNumber, filingDate, cik }
    });
  }
  return signals;
}
