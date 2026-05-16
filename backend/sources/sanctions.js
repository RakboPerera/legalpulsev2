import { XMLParser } from 'fast-xml-parser';
import { fetchExternal } from '../lib/http.js';
import { signalId } from '../lib/ids.js';

const CACHE_TTL = 1000 * 60 * 60 * 6; // 6h

function safeArr(v) { return Array.isArray(v) ? v : (v != null ? [v] : []); }

export async function fetchOfacSdn() {
  const url = 'https://www.treasury.gov/ofac/downloads/sdn.xml';
  const xml = await fetchExternal({
    source: 'ofac_sdn',
    url,
    responseType: 'text',
    cacheTtlMs: CACHE_TTL,
    timeoutMs: 60000,
    maxRetries: 2
  });
  if (!xml) return [];
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  let parsed;
  try { parsed = parser.parse(xml); } catch (err) { console.warn('[ofac] parse failed:', err.message); return []; }
  const entries = safeArr(parsed?.sdnList?.sdnEntry);
  return entries.map(e => ({
    name: (e.firstName ? `${e.firstName} ` : '') + (e.lastName || ''),
    type: e.sdnType,
    program: safeArr(e.programList?.program).join(', '),
    raw: e
  }));
}

function splitCsvRow(row) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      if (inQuotes && row[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cells.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

export async function fetchUkOfsi() {
  const url = 'https://ofsistorage.blob.core.windows.net/publishlive/2022format/ConList.csv';
  const csv = await fetchExternal({
    source: 'uk_ofsi',
    url,
    responseType: 'text',
    cacheTtlMs: CACHE_TTL,
    timeoutMs: 60000,
    maxRetries: 2
  });
  if (!csv) return [];
  const rows = csv.split('\n').slice(1).filter(Boolean);
  const out = [];
  for (const row of rows) {
    const cells = splitCsvRow(row);
    if (cells.length < 2) continue;
    const name = `${cells[0]} ${cells[1] || ''}`.trim();
    if (name) out.push({ name, raw: cells });
  }
  return out;
}

// Reject obviously bogus SDN entries that are CSV-parse artefacts (single
// short tokens) and aliases that are too short to be safely matched without
// massive false-positive rates.
const ALIAS_MIN_LEN = 5;        // skip "BP", "GS", "GM", "Total", "Chase", "EU"
const SDN_NAME_MIN_LEN = 6;     // skip "AB", "ANO", "GI", "SO", "ALE", "TIS"
const SDN_NAME_MIN_TOKENS = 2;  // require at least 2 word tokens — single-token "names" are usually parse artefacts

// Tokenise a legal name for matching: lowercase, split on whitespace +
// common punctuation, drop short noise tokens and corporate-form suffixes
// that cause spurious cross-matches (LLC, INC, CORP, etc.).
const NOISE_TOKENS = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'for', 'in', 'on',
  'inc', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited',
  'plc', 'llc', 'lp', 'llp', 'sa', 'se', 'ag', 'nv', 'pbc',
  'group', 'holdings', 'holding'
]);
function tokenize(name) {
  return (name || '')
    .toLowerCase()
    .split(/[\s,.&\-_/'()]+/)
    .filter(t => t.length >= 3 && !NOISE_TOKENS.has(t));
}

export function crossReferenceSanctions(entityNames, sanctionsList) {
  const signals = [];
  if (!sanctionsList?.length) return signals;

  // Pre-tokenise the SDN list once. Drop entries whose name is too short or
  // has too few real tokens (CSV artefacts).
  const indexed = sanctionsList
    .filter(s => {
      const name = s.name || '';
      if (name.length < SDN_NAME_MIN_LEN) return false;
      const toks = tokenize(name);
      return toks.length >= SDN_NAME_MIN_TOKENS;
    })
    .map(s => ({ ...s, _tokens: new Set(tokenize(s.name)) }));

  // De-dup entity names and drop short aliases that cause false positives.
  const safeEntities = Array.from(new Set(entityNames.filter(n => n && n.length >= ALIAS_MIN_LEN)));

  for (const entity of safeEntities) {
    const entTokens = tokenize(entity);
    if (entTokens.length === 0) continue;

    // Match rule: ALL of the entity's significant tokens must appear in the
    // SDN entry's token set. This eliminates "BP" matching "BPS-SBERBANK"
    // (because BPS != BP) and "GS" matching "FARTRADE HOLDINGS" (FARTRADE
    // tokenises to ['fartrade'], no 'gs' token).
    const hits = indexed.filter(s => entTokens.every(t => s._tokens.has(t)));
    if (hits.length) {
      // Build a content-sensitive ID so each entity gets a unique signal even
      // when generated in the same run. Including the first hit's name salts
      // the hash uniquely per match cluster.
      const idSalt = `${hits[0].name}::${hits.length}`;
      signals.push({
        id: signalId(entity, 'sanctions_check', idSalt, new Date().toISOString().slice(0, 10)),
        source: 'ofac_sdn',
        sourceUrl: 'https://www.treasury.gov/ofac/downloads/sdn.xml',
        ingestionTimestamp: new Date().toISOString(),
        publishedAt: new Date().toISOString(),
        title: `Possible OFAC SDN match — ${entity}`,
        description: `Token-exact match against ${hits.length} OFAC SDN entr${hits.length === 1 ? 'y' : 'ies'}: ${hits.slice(0, 3).map(h => h.name).join('; ')}`,
        // Leave entities empty — let the deep entity linker (which uses
        // word-boundary regex on the firm's own client/prospect aliases) do
        // the real attribution on this signal's title/description.
        entities: [],
        jurisdictions: ['USA'],
        rawMetadata: { hits: hits.slice(0, 5).map(h => ({ name: h.name, program: h.program })), queriedFor: entity }
      });
    }
  }
  return signals;
}
