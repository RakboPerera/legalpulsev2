// FDA Warning Letters fetcher. The FDA does not publish an RSS feed for
// warning letters; we scrape the public listing page and parse the table
// structure into the shared signal shape. Only used during the bake — kept
// behind a "best-effort" wrapper so a layout change at fda.gov doesn't crash
// the run, just surfaces zero signals from this source.
import * as cheerio from 'cheerio';
import { fetchExternal } from '../lib/http.js';
import { signalId } from '../lib/ids.js';

const LISTING_URL = 'https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/warning-letters';

export async function fetchFdaWarningLetters({ maxRecords = 30 } = {}) {
  let html;
  try {
    html = await fetchExternal({
      source: 'fda_warning_letters',
      url: LISTING_URL,
      responseType: 'text',
      cacheTtlMs: 1000 * 60 * 60 * 6, // 6h
      headers: { 'User-Agent': process.env.SEC_EDGAR_USER_AGENT || 'LegalPulse Demo' }
    });
  } catch (err) {
    console.warn('[fda_warning_letters] fetch failed:', err.message);
    return [];
  }
  if (!html) return [];

  // The page renders a sortable table. Parse rows: each row has columns
  // [Posted Date | Letter Issue Date | Company Name | Issuing Office | Subject | Response Letter | Closeout Letter].
  const $ = cheerio.load(html);
  const rows = $('table tbody tr').toArray();
  const signals = [];
  for (const row of rows.slice(0, maxRecords)) {
    const cells = $(row).find('td').toArray().map(td => $(td).text().trim());
    if (cells.length < 5) continue;
    const [postedDate, issueDate, companyName, issuingOffice, subject] = cells;
    if (!companyName || !subject) continue;
    // Find the link to the letter — usually in the company name column.
    const linkAnchor = $(row).find('a').first();
    const href = linkAnchor.attr('href') || '';
    const letterUrl = href.startsWith('http') ? href : (href ? `https://www.fda.gov${href}` : LISTING_URL);

    signals.push({
      id: signalId('fda_warning_letters', companyName, letterUrl, issueDate || postedDate),
      source: 'fda_warning_letters',
      sourceUrl: letterUrl,
      ingestionTimestamp: new Date().toISOString(),
      publishedAt: parseDateGuess(issueDate || postedDate),
      title: `FDA Warning Letter — ${companyName}`,
      // Subject line of the warning letter is typically the GMP/labelling/AE
      // citation that drove the action — directly useful as a legal trigger.
      description: `Issuing office: ${issuingOffice || 'n/a'}. Subject: ${subject}`,
      entities: [],
      jurisdictions: ['USA'],
      rawMetadata: {
        companyName,
        issuingOffice,
        subject,
        postedDate,
        issueDate
      }
    });
  }
  return signals;
}

function parseDateGuess(s) {
  if (!s) return new Date().toISOString();
  // FDA listings use formats like "05/08/2026" or "May 8, 2026". Date parses both.
  const t = Date.parse(s);
  if (!isNaN(t)) return new Date(t).toISOString();
  return new Date().toISOString();
}
