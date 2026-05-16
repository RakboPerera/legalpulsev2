// Single source of truth for the list of source identifiers the workspace
// accepts. Used by every router that validates externalSourceConfig inputs
// so we don't drift between routes (a source allowed in one place but
// silently dropped in another). Must include EVERY source the bake or the
// runtime orchestrator can actually produce signals from — otherwise
// `sanitizeExternalConfig` silently strips them and the UI lies about what
// sources are enabled.
export const ALLOWED_SOURCES = new Set([
  // External fetchers
  'tavily',
  'gdelt', 'edgar', 'courtlistener', 'companies_house', 'federal_register', 'eur_lex',
  // Sanctions
  'ofac_sdn', 'eu_sanctions', 'uk_ofsi', 'sanctions_cross_ref',
  // RSS feeds — the full list bake-demo.js iterates
  'doj', 'ftc', 'dg_comp', 'fca', 'fca_govuk', 'cma', 'ico_govuk', 'ofcom',
  'bank_of_england', 'hmt', 'cftc', 'govuk',
  // Lower-volume specialised
  'uspto', 'fda_warning_letters', 'career_page',
  // Legacy / commented-out (kept to avoid silent strip on existing workspace state)
  'lexology', 'jd_supra'
]);

export const ALLOWED_GEOGRAPHIES = new Set(['UK', 'EU', 'USA']);
