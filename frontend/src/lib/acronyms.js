// Curated legal / regulatory / business acronyms that appear in LegalPulse
// content (LLM-composed summaries, briefings, signal titles, source labels).
// Keys are the on-screen form; each entry has an `expansion` (long-form) and a
// short `description` explaining what the term means in our context.
//
// Order matters for the matching regex below — multi-character / hyphenated
// terms are listed first so they win over their substrings (e.g. "DG COMP"
// must match before "EU"). Add new entries here as the corpus grows; the
// AcronymText component picks them up automatically.

export const LEGAL_ACRONYMS = {
  'M&A': {
    expansion: 'Mergers and Acquisitions',
    description: 'Corporate transactions involving the consolidation of companies or assets — buyouts, mergers, asset purchases, takeovers.'
  },
  'DG COMP': {
    expansion: 'Directorate-General for Competition (European Commission)',
    description: 'EU body responsible for enforcing competition law, including merger control, antitrust, and state aid.'
  },
  'OFAC': {
    expansion: 'Office of Foreign Assets Control',
    description: 'US Treasury division that administers and enforces economic and trade sanctions.'
  },
  'SDN': {
    expansion: 'Specially Designated Nationals',
    description: 'OFAC\'s primary sanctions list. US persons are generally prohibited from dealing with parties on this list.'
  },
  'OFSI': {
    expansion: 'Office of Financial Sanctions Implementation',
    description: 'UK HM Treasury body responsible for implementing financial sanctions.'
  },
  'EDGAR': {
    expansion: 'Electronic Data Gathering, Analysis, and Retrieval',
    description: 'The SEC\'s online filings system. All US-listed company filings (10-K, 10-Q, 8-K, etc.) appear here.'
  },
  'GDELT': {
    expansion: 'Global Database of Events, Language, and Tone',
    description: 'A free, open database that monitors news media worldwide. LegalPulse uses it for event detection.'
  },
  'FCA': {
    expansion: 'Financial Conduct Authority',
    description: 'UK regulator overseeing financial services firms and markets.'
  },
  'DOJ': {
    expansion: 'Department of Justice',
    description: 'US federal department responsible for enforcement of federal law, including antitrust and white-collar criminal cases.'
  },
  'FTC': {
    expansion: 'Federal Trade Commission',
    description: 'US regulator responsible for consumer protection and antitrust enforcement.'
  },
  'SEC': {
    expansion: 'Securities and Exchange Commission',
    description: 'US regulator overseeing securities markets and public-company disclosures.'
  },
  'PACER': {
    expansion: 'Public Access to Court Electronic Records',
    description: 'US federal court records system. CourtListener republishes a free portion of PACER data.'
  },
  'EUR-Lex': {
    expansion: 'EU legal database',
    description: 'Official EU portal for legislation, treaties, case law, and other legal acts.'
  },
  'USPTO': {
    expansion: 'United States Patent and Trademark Office',
    description: 'US federal agency that grants patents and registers trademarks.'
  },
  'IPO': {
    expansion: 'Initial Public Offering',
    description: 'A company\'s first sale of stock to the public, typically triggering significant securities and disclosure work.'
  },
  'IP': {
    expansion: 'Intellectual Property',
    description: 'Legal rights covering creations of the mind — patents, trademarks, copyrights, trade secrets.'
  },
  'FDI': {
    expansion: 'Foreign Direct Investment',
    description: 'Cross-border investment by a company or individual into business interests in another country. Subject to national security screening in many jurisdictions.'
  },
  'ESG': {
    expansion: 'Environmental, Social and Governance',
    description: 'Framework for evaluating non-financial corporate performance. Increasingly subject to mandatory disclosure rules.'
  },
  'AI': {
    expansion: 'Artificial Intelligence',
    description: 'Software systems that perform tasks typically requiring human intelligence. Subject to emerging EU and US regulation.'
  },
  'LLM': {
    expansion: 'Large Language Model',
    description: 'AI model trained to understand and generate text (e.g. Claude, GPT). LegalPulse uses LLMs for opportunity composition, briefing generation, and chat.'
  },
  'BD': {
    expansion: 'Business Development',
    description: 'The function of identifying and pursuing new client opportunities. LegalPulse is a BD intelligence platform.'
  },
  'GC': {
    expansion: 'General Counsel',
    description: 'A company\'s most senior in-house lawyer. Typically the firm\'s primary outside-counsel buyer.'
  },
  'CEO': {
    expansion: 'Chief Executive Officer',
    description: 'A company\'s most senior executive.'
  },
  'CFO': {
    expansion: 'Chief Financial Officer',
    description: 'A company\'s most senior finance executive.'
  },
  'COO': {
    expansion: 'Chief Operating Officer',
    description: 'A company\'s most senior operations executive.'
  },
  'LEI': {
    expansion: 'Legal Entity Identifier',
    description: 'A 20-character ID uniquely identifying a legal entity in financial transactions worldwide.'
  },
  'CIK': {
    expansion: 'Central Index Key',
    description: 'A 10-digit number assigned by the SEC to each filer. Used to look up filings on EDGAR.'
  },
  'KYC': {
    expansion: 'Know Your Customer',
    description: 'Regulatory due-diligence process to verify the identity and risk profile of clients. Especially important in financial services.'
  },
  'AML': {
    expansion: 'Anti-Money Laundering',
    description: 'Laws, regulations, and procedures designed to prevent the disguise of illegally obtained funds.'
  },
  'BYOK': {
    expansion: 'Bring Your Own Key',
    description: 'A deployment model where the customer supplies their own LLM API key. LegalPulse production deployments support BYOK.'
  },
  'API': {
    expansion: 'Application Programming Interface',
    description: 'A defined interface for software components to communicate with each other.'
  },
  'KPI': {
    expansion: 'Key Performance Indicator',
    description: 'A measurable value used to evaluate progress toward a goal.'
  },
  'PFAS': {
    expansion: 'Per- and Polyfluoroalkyl Substances',
    description: '"Forever chemicals" — a class of synthetic compounds increasingly subject to environmental litigation and disclosure obligations.'
  },
  'RICO': {
    expansion: 'Racketeer Influenced and Corrupt Organizations Act',
    description: 'US federal statute providing for extended criminal penalties and a civil cause of action for acts performed as part of an ongoing criminal organization.'
  },
  '10-K': {
    expansion: 'Annual report (SEC Form 10-K)',
    description: 'A comprehensive annual report on a US-listed company\'s financial performance, filed with the SEC.'
  },
  '10-Q': {
    expansion: 'Quarterly report (SEC Form 10-Q)',
    description: 'A quarterly report on a US-listed company\'s financial performance, filed with the SEC.'
  },
  '8-K': {
    expansion: 'Current report (SEC Form 8-K)',
    description: 'A report filed with the SEC to announce major events shareholders should know about.'
  },
  'plc': {
    expansion: 'public limited company',
    description: 'A UK-incorporated entity whose shares are offered to the general public.'
  },
  'LLP': {
    expansion: 'Limited Liability Partnership',
    description: 'A partnership where some or all partners have limited personal liability. Most modern law firms are LLPs.'
  },
  'PBC': {
    expansion: 'Public Benefit Corporation',
    description: 'A US for-profit corporation legally required to consider the impact of decisions on stakeholders beyond shareholders.'
  },
  'EU': {
    expansion: 'European Union',
    description: 'Political and economic union of 27 European member states. Source of competition, sanctions, and increasingly AI/data rules.'
  },
  'UK': {
    expansion: 'United Kingdom',
    description: 'Sovereign state in north-western Europe. Distinct from the EU since 2020.'
  },
  'USA': {
    expansion: 'United States of America',
    description: 'Federal republic of 50 states. Major source of antitrust, securities, and sanctions law applied to LegalPulse signals.'
  },
  'JKH': {
    expansion: 'John Keells Holdings PLC',
    description: 'Sri Lankan diversified conglomerate. Internal context — LegalPulse is being built within JKH.'
  }
};

// Build the matching regex once at module load. Sorted longest-first so that
// "DG COMP" wins over "EU" (no overlap risk anyway, but defensive). Word
// boundaries on both sides so that "EU" inside "EUR" doesn't match.
const KEYS_DESC_BY_LENGTH = Object.keys(LEGAL_ACRONYMS).sort((a, b) => b.length - a.length);

// Escape regex metacharacters in keys (& and -). Build a single global regex.
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// `\\b` doesn't work cleanly around symbols like "&" or "-" so we use lookarounds
// — a non-word/start before, non-word/end after. JavaScript supports lookaround
// in modern browsers and Node 20+.
export const ACRONYM_REGEX = new RegExp(
  '(?<![A-Za-z0-9])(' + KEYS_DESC_BY_LENGTH.map(escapeRegex).join('|') + ')(?![A-Za-z0-9])',
  'g'
);

export function lookupAcronym(token) {
  return LEGAL_ACRONYMS[token] || null;
}
