// Minimal CSV importer for User Input Mode workspaces.
//
// Supports two file types — `clients` and `matters` — with the columns
// documented in the frontend template downloads. Quoted cells, escaped
// quotes (""), and CR/LF line endings are handled. We deliberately do not
// pull in a CSV dependency: the schema is tiny, the input is partner-
// uploaded and small, and rolling our own keeps the audit surface narrow.

import crypto from 'crypto';

const MAX_BYTES = 512 * 1024;          // 512 KB per file
const MAX_ROWS = 5000;
const MAX_NAME = 200;

// --- Tokenizer ---------------------------------------------------------

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip UTF-8 BOM
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  // Trailing cell / row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop completely-empty trailing rows
  while (rows.length && rows[rows.length - 1].every(c => c.trim() === '')) rows.pop();
  return rows;
}

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'entity';
}

// --- Client importer ---------------------------------------------------

const CLIENT_HEADER_ALIASES = {
  legalname:        'legalName',
  name:             'legalName',
  client:           'legalName',
  clientname:       'legalName',
  sector:           'sector',
  industry:         'sector',
  subsector:        'subSector',
  hqjurisdiction:   'hqJurisdiction',
  hq:               'hqJurisdiction',
  jurisdiction:     'hqJurisdiction',
  size:             'size',
  knownaliases:     'knownAliases',
  aliases:          'knownAliases',
  publicentityurl:  'publicEntityUrl',
  website:          'publicEntityUrl'
};

const SIZE_ALLOWED = new Set(['mega', 'large', 'mid', 'small', 'sme']);

function importClients(text, existingClientsByName) {
  const rows = parseCsv(text);
  if (rows.length < 1) return { added: [], errors: [], skipped: 0 };
  if (rows.length > MAX_ROWS + 1) return { added: [], errors: [{ row: 0, message: `Too many rows (max ${MAX_ROWS}).` }], skipped: 0 };

  const headerRow = rows[0].map(normalizeHeader);
  const colMap = headerRow.map(h => CLIENT_HEADER_ALIASES[h] || null);
  if (!colMap.includes('legalName')) {
    return { added: [], errors: [{ row: 1, message: 'Missing required column: legalName (or name).' }], skipped: 0 };
  }

  const added = [];
  const errors = [];
  let skipped = 0;
  const seen = new Map(existingClientsByName); // case-insensitive name lookup

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every(c => String(c || '').trim() === '')) { skipped++; continue; }

    const obj = {};
    for (let c = 0; c < colMap.length; c++) {
      const key = colMap[c];
      if (!key) continue;
      obj[key] = String(row[c] ?? '').trim();
    }

    if (!obj.legalName) { errors.push({ row: r + 1, message: 'legalName is required.' }); continue; }
    if (obj.legalName.length > MAX_NAME) { errors.push({ row: r + 1, message: 'legalName too long.' }); continue; }
    if (obj.size && !SIZE_ALLOWED.has(obj.size.toLowerCase())) {
      errors.push({ row: r + 1, message: `size must be one of ${[...SIZE_ALLOWED].join(', ')}.` });
      continue;
    }

    const key = obj.legalName.toLowerCase();
    if (seen.has(key)) { skipped++; continue; }

    const aliases = (obj.knownAliases || '')
      .split(/[;|]/)
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 20);

    const client = {
      id: `c-${slug(obj.legalName)}-${crypto.randomBytes(2).toString('hex')}`,
      legalName: obj.legalName,
      knownAliases: aliases.length ? aliases : [obj.legalName],
      sector: obj.sector ? obj.sector.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') : 'unspecified',
      subSector: obj.subSector || null,
      hqJurisdiction: obj.hqJurisdiction || 'UK',
      size: (obj.size || 'mid').toLowerCase(),
      countriesOfOperation: [],
      externalIdentifiers: {},
      publicEntityUrl: obj.publicEntityUrl || null,
      decisionMakers: [],
      relationshipMaturity: 'active'
    };
    seen.set(key, client);
    added.push(client);
  }

  return { added, errors, skipped };
}

// --- Matter importer ---------------------------------------------------

const MATTER_HEADER_ALIASES = {
  mattertitle:       'matterTitle',
  title:             'matterTitle',
  matter:            'matterTitle',
  clientlegalname:   'clientLegalName',
  client:            'clientLegalName',
  clientname:        'clientLegalName',
  practicearea:      'practiceArea',
  practice:          'practiceArea',
  leadpartner:       'leadPartner',
  partner:           'leadPartner',
  status:            'status',
  startdate:         'startDate',
  enddate:           'endDate',
  feesbilled:        'feesBilled',
  fees:              'feesBilled',
  currency:          'currency',
  services:          'services',
  outcome:           'outcome'
};

const STATUS_ALLOWED = new Set(['open', 'closed_won', 'closed_lost', 'on_hold', 'closed']);

function parseFees(v) {
  if (!v) return null;
  const cleaned = String(v).replace(/[^\d.-]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function importMatters(text, clientsByName) {
  const rows = parseCsv(text);
  if (rows.length < 1) return { added: [], errors: [], skipped: 0 };
  if (rows.length > MAX_ROWS + 1) return { added: [], errors: [{ row: 0, message: `Too many rows (max ${MAX_ROWS}).` }], skipped: 0 };

  const headerRow = rows[0].map(normalizeHeader);
  const colMap = headerRow.map(h => MATTER_HEADER_ALIASES[h] || null);
  if (!colMap.includes('matterTitle')) {
    return { added: [], errors: [{ row: 1, message: 'Missing required column: matterTitle (or title).' }], skipped: 0 };
  }
  if (!colMap.includes('clientLegalName')) {
    return { added: [], errors: [{ row: 1, message: 'Missing required column: clientLegalName (or client).' }], skipped: 0 };
  }

  const added = [];
  const errors = [];
  let skipped = 0;
  let auto = 1;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every(c => String(c || '').trim() === '')) { skipped++; continue; }

    const obj = {};
    for (let c = 0; c < colMap.length; c++) {
      const key = colMap[c];
      if (!key) continue;
      obj[key] = String(row[c] ?? '').trim();
    }

    if (!obj.matterTitle) { errors.push({ row: r + 1, message: 'matterTitle is required.' }); continue; }
    if (!obj.clientLegalName) { errors.push({ row: r + 1, message: 'clientLegalName is required.' }); continue; }
    if (obj.matterTitle.length > 280) { errors.push({ row: r + 1, message: 'matterTitle too long (max 280).' }); continue; }

    const clientKey = obj.clientLegalName.toLowerCase();
    const client = clientsByName.get(clientKey);
    if (!client) {
      errors.push({ row: r + 1, message: `Client "${obj.clientLegalName}" not found. Upload the client first, or include the matching row in the clients file.` });
      continue;
    }

    if (obj.status && !STATUS_ALLOWED.has(obj.status.toLowerCase())) {
      errors.push({ row: r + 1, message: `status must be one of ${[...STATUS_ALLOWED].join(', ')}.` });
      continue;
    }

    const matter = {
      id: `M-${new Date().getFullYear()}-${String(auto++).padStart(4, '0')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
      client: client.id,
      matterTitle: obj.matterTitle,
      practiceArea: obj.practiceArea ? obj.practiceArea.toLowerCase().replace(/\s+/g, '_') : 'unspecified',
      leadPartner: obj.leadPartner || null,
      services: (obj.services || '')
        .split(/[;|]/)
        .map(s => s.trim().toLowerCase().replace(/\s+/g, '_'))
        .filter(Boolean)
        .slice(0, 10),
      startDate: obj.startDate || null,
      endDate: obj.endDate || null,
      status: (obj.status || 'open').toLowerCase(),
      feesBilled: parseFees(obj.feesBilled),
      currency: obj.currency || 'GBP',
      outcome: obj.outcome || null,
      kpiSource: 'csv_import'
    };
    added.push(matter);
  }

  return { added, errors, skipped };
}

// --- Public entry point -----------------------------------------------

export function ingestCsv(workspace, files) {
  if (workspace.mode !== 'user_input') {
    return { ok: false, error: 'CSV ingestion is only supported in user input mode.' };
  }
  const summary = {
    clients: { added: 0, skipped: 0, errors: [] },
    matters: { added: 0, skipped: 0, errors: [] }
  };

  const byName = new Map();
  for (const c of workspace.clients || []) byName.set(c.legalName.toLowerCase(), c);

  if (files.clients) {
    if (files.clients.size > MAX_BYTES) {
      summary.clients.errors.push({ row: 0, message: `Clients file is too large (max ${Math.round(MAX_BYTES / 1024)} KB).` });
    } else {
      const r = importClients(files.clients.buffer.toString('utf8'), byName);
      workspace.clients = (workspace.clients || []).concat(r.added);
      for (const c of r.added) byName.set(c.legalName.toLowerCase(), c);
      summary.clients.added = r.added.length;
      summary.clients.skipped = r.skipped;
      summary.clients.errors = r.errors.slice(0, 50);
    }
  }

  if (files.matters) {
    if (files.matters.size > MAX_BYTES) {
      summary.matters.errors.push({ row: 0, message: `Matters file is too large (max ${Math.round(MAX_BYTES / 1024)} KB).` });
    } else {
      const r = importMatters(files.matters.buffer.toString('utf8'), byName);
      workspace.matters = (workspace.matters || []).concat(r.added);
      summary.matters.added = r.added.length;
      summary.matters.skipped = r.skipped;
      summary.matters.errors = r.errors.slice(0, 50);
    }
  }

  return { ok: true, summary };
}

export const CSV_LIMITS = { MAX_BYTES, MAX_ROWS };
