// Centralised label dictionaries.
//
// The data layer uses snake_case identifiers throughout (sectors, services,
// urgency tiers, source IDs, etc.). Component code that wants to render them
// should call into here rather than doing ad-hoc .replace(/_/g, ' ') — that
// keeps capitalisation, special cases (e.g. "M&A" not "M and a"), and
// partner-vs-developer copy in one place.

const SECTOR = {
  oil_gas:              'Oil & gas',
  financial_services:   'Financial services',
  technology:           'Technology',
  pharma:               'Pharmaceuticals',
  pharmaceuticals:      'Pharmaceuticals',
  automotive:           'Automotive',
  consumer_goods:       'Consumer goods',
  consumer:             'Consumer',
  retail:               'Retail',
  telecoms:             'Telecoms',
  defense:              'Defence',
  defence:              'Defence',
  mining:               'Mining',
  shipping:             'Shipping',
  manufacturing:        'Manufacturing',
  media:                'Media',
  insurance:            'Insurance',
  banking:              'Banking',
  energy:               'Energy',
  utilities:            'Utilities',
  ai:                   'AI',
  software:             'Software'
};

const SERVICE = {
  ai_litigation:                'AI litigation',
  class_actions:                'Class actions',
  commercial_litigation:        'Commercial litigation',
  competition:                  'Competition',
  cross_border_ma:              'Cross-border M&A',
  cross_border_litigation:      'Cross-border litigation',
  financial_services_regulation:'Financial services regulation',
  force_majeure_advisory:       'Force-majeure advisory',
  ip_advisory:                  'IP advisory',
  litigation_disputes:          'Litigation & disputes',
  merger_control:               'Merger control',
  ofac_advisory:                'OFAC sanctions advisory',
  patent_litigation:            'Patent litigation',
  regulatory_defense:           'Regulatory defence',
  regulatory_defence:           'Regulatory defence',
  securities_litigation:        'Securities litigation',
  tax:                          'Tax',
  uk_competition:               'UK competition',
  white_collar:                 'White-collar defence'
};

const URGENCY = {
  immediate:     'Immediate',
  this_week:     'This week',
  steady_state:  'Steady state'
};

const STATUS = {
  open:        'Open',
  closed:      'Closed',
  closed_won:  'Closed — won',
  closed_lost: 'Closed — lost',
  on_hold:     'On hold',
  proposed:    'Proposed',
  pitched:     'Pitched',
  saved:       'Saved',
  dismissed:   'Dismissed'
};

const SOURCE = {
  tavily:              'Tavily',
  gdelt:               'GDELT',
  edgar:               'SEC EDGAR',
  courtlistener:       'CourtListener',
  companies_house:     'Companies House',
  federal_register:    'US Federal Register',
  ofac_sdn:            'OFAC SDN',
  eu_sanctions:        'EU sanctions',
  uk_ofsi:             'UK OFSI',
  doj:                 'US DOJ',
  ftc:                 'US FTC',
  cftc:                'US CFTC',
  dg_comp:             'EU DG COMP',
  fca:                 'UK FCA',
  fca_govuk:           'UK FCA (gov.uk)',
  cma:                 'UK CMA',
  ico_govuk:           'UK ICO',
  ofcom:               'UK Ofcom',
  bank_of_england:     'Bank of England',
  hmt:                 'HM Treasury',
  fda_warning_letters: 'US FDA warning letters'
};

const ENGINE = {
  cross_sell:           'Cross-sell',
  prospect_discovery:   'Prospect discovery',
  event_intelligence:   'Event intelligence'
};

// Generic snake_case → Sentence case fallback for any value the dictionaries
// above don't cover. Special-cases "vs" → "vs.", "and" lowercase, etc.
export function labelize(s) {
  if (s == null) return '';
  if (typeof s !== 'string') return String(s);
  return s
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, c => c.toUpperCase())
    .replace(/\b(of|and|the|or|in|on|for|to)\b/gi, w => w.toLowerCase());
}

export function prettySector(s)   { return SECTOR[s]   ?? labelize(s); }
export function prettyService(s)  { return SERVICE[s]  ?? labelize(s); }
export function prettyUrgency(s)  { return URGENCY[s]  ?? labelize(s); }
export function prettyStatus(s)   { return STATUS[s]   ?? labelize(s); }
export function prettySource(s)   { return SOURCE[s]   ?? labelize(s); }
export function prettyEngine(s)   { return ENGINE[s]   ?? labelize(s); }
