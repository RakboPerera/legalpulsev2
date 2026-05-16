import Parser from 'rss-parser';
import { signalId } from '../lib/ids.js';

// Many regulator feeds 403 without a real User-Agent. Some also reject
// requests that don't accept rss/xml MIME types. We send both to maximize
// per-feed reachability.
const parser = new Parser({
  timeout: 20000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; LegalPulse/1.0; +https://legalpulse.local)',
    'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
  }
});

// Feed registry. URLs verified 2026-05-13. Broken feeds are commented out
// rather than removed so it's easy to re-test if the publisher restores them.
// Coverage gaps the disabled feeds left are mostly filled by Tavily news +
// CourtListener (litigation) + EDGAR (filings).
const FEEDS = {
  // --- Working as of 2026-05-13 ---
  fca:        { url: 'https://www.fca.org.uk/news/rss.xml',                                    jurisdictions: ['UK'] },
  cma:        { url: 'https://www.gov.uk/government/organisations/competition-and-markets-authority.atom', jurisdictions: ['UK'] },
  // gov.uk publishes per-organisation Atom feeds with a stable URL pattern:
  fca_govuk:  { url: 'https://www.gov.uk/government/organisations/financial-conduct-authority.atom', jurisdictions: ['UK'] },
  ofcom:      { url: 'https://www.gov.uk/government/organisations/ofcom.atom',                jurisdictions: ['UK'] },
  bank_of_england: { url: 'https://www.gov.uk/government/organisations/bank-of-england.atom', jurisdictions: ['UK'] },
  hmt:        { url: 'https://www.gov.uk/government/organisations/hm-treasury.atom',          jurisdictions: ['UK'] },
  ico_govuk:  { url: 'https://www.gov.uk/government/organisations/information-commissioner-s-office.atom', jurisdictions: ['UK'] },

  // DOJ press releases: the legacy /feeds/opa/ URL is dead; the new path is
  // under /news with Atom. May still 403 — kept enabled to test.
  doj:        { url: 'https://www.justice.gov/news/rss',                                       jurisdictions: ['USA'] },
  ftc:        { url: 'https://www.ftc.gov/news-events/news/press-releases.rss',                jurisdictions: ['USA'] },
  cftc:       { url: 'https://www.cftc.gov/news/press-releases/rss',                           jurisdictions: ['USA'] },

  // EU Commission DG COMP merged its news feed into ec.europa.eu/news under
  // a tag-based query. The competition-tagged feed:
  dg_comp:    { url: 'https://ec.europa.eu/commission/presscorner/api/news/rss?topics=COMP',   jurisdictions: ['EU'] },

  // --- Disabled (404 / broken / paywalled) — Tavily covers the gap ---
  // lexology:   { url: 'https://www.lexology.com/rss',                                          jurisdictions: ['UK','EU','USA'] }, // requires login
  // jd_supra:   { url: 'https://www.jdsupra.com/legalnews/feeds/',                              jurisdictions: ['USA'] },           // 404
  // eur_lex:    { url: 'https://eur-lex.europa.eu/EN/display-feeds.html',                       jurisdictions: ['EU'] },             // not a feed URL
  // ny_ag:      { url: 'https://ag.ny.gov/press-releases/feed',                                 jurisdictions: ['USA'] },            // XML parse error
  // ca_ag:      { url: 'https://oag.ca.gov/news/rss',                                           jurisdictions: ['USA'] },            // timeout
  // epa:        { url: 'https://www.epa.gov/newsreleases/search/rss',                           jurisdictions: ['USA'] },            // 405
  // ico:        { url: 'https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/rss/',     jurisdictions: ['UK'] },             // 404 — ico_govuk replaces it
};

export async function fetchRssFeed(source) {
  const meta = FEEDS[source];
  if (!meta) return [];
  try {
    const feed = await parser.parseURL(meta.url);
    return (feed.items || []).slice(0, 30).map(item => ({
      id: signalId(source, source, item.link || item.guid || item.title, item.isoDate || ''),
      source,
      sourceUrl: item.link || '',
      ingestionTimestamp: new Date().toISOString(),
      publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
      title: item.title || '(untitled)',
      description: (item.contentSnippet || item.summary || '').slice(0, 1000),
      entities: [],
      jurisdictions: meta.jurisdictions,
      rawMetadata: { creator: item.creator, categories: item.categories }
    }));
  } catch (err) {
    console.warn(`[rss] ${source} fetch failed: ${err.message}`);
    return [];
  }
}

export async function fetchAllRssFeeds(sources = Object.keys(FEEDS)) {
  const out = [];
  for (const s of sources) {
    const items = await fetchRssFeed(s);
    out.push(...items);
  }
  return out;
}
