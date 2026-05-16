// Hand-authored credit ratings, outlooks, and risk flags for the seed clients
// and prospects. Calibrated to plausible real-world S&P / Fitch / Moody's
// ratings for these public companies (and intentionally varied so the demo
// shows HIGH / MEDIUM / LOW tiers across the worthiness banner).
//
// Run with:  node scripts/backfill-seed-credit.js
// Idempotent — existing fields are overwritten with the values in this file.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Risk-flag vocabulary (kept short and partner-readable):
//   regulatory_pressure  — active enforcement or large pending review
//   sanctions_adjacent   — operations in sanctioned jurisdictions / OFAC exposure
//   distressed           — financial or operational difficulty disclosed
//   esg_pressure         — climate / disclosure / activist litigation exposure
//   litigation_heavy     — three or more active class actions

const CLIENT_CREDIT = {
  'c-bp':       { creditRating: 'A-',   creditOutlook: 'stable',    riskFlags: ['esg_pressure'] },
  'c-hsbc':     { creditRating: 'A+',   creditOutlook: 'stable',    riskFlags: ['regulatory_pressure'] },
  'c-maersk':   { creditRating: 'BBB+', creditOutlook: 'stable',    riskFlags: [] },
  'c-vw':       { creditRating: 'BBB+', creditOutlook: 'negative',  riskFlags: ['regulatory_pressure', 'litigation_heavy'] },
  'c-asml':     { creditRating: 'A+',   creditOutlook: 'stable',    riskFlags: ['sanctions_adjacent'] },
  'c-rolls':    { creditRating: 'BBB-', creditOutlook: 'positive',  riskFlags: [] },
  'c-vodafone': { creditRating: 'BBB',  creditOutlook: 'stable',    riskFlags: [] },
  'c-exxon':    { creditRating: 'AA-',  creditOutlook: 'stable',    riskFlags: ['esg_pressure'] },
  'c-boeing':   { creditRating: 'BBB-', creditOutlook: 'negative',  riskFlags: ['regulatory_pressure', 'distressed', 'litigation_heavy'] },
  'c-gs':       { creditRating: 'A+',   creditOutlook: 'stable',    riskFlags: [] },
  'c-jpm':      { creditRating: 'A+',   creditOutlook: 'stable',    riskFlags: [] },
  'c-msft':     { creditRating: 'AAA',  creditOutlook: 'stable',    riskFlags: ['regulatory_pressure'] },
  'c-citi':     { creditRating: 'A',    creditOutlook: 'stable',    riskFlags: ['regulatory_pressure'] },
  'c-bofa':     { creditRating: 'A',    creditOutlook: 'stable',    riskFlags: [] },
  'c-ms':       { creditRating: 'A+',   creditOutlook: 'stable',    riskFlags: [] },
  'c-barclays': { creditRating: 'A',    creditOutlook: 'stable',    riskFlags: [] },
  'c-gsk':      { creditRating: 'A',    creditOutlook: 'stable',    riskFlags: ['litigation_heavy'] },
  'c-merck':    { creditRating: 'AA-',  creditOutlook: 'stable',    riskFlags: [] },
  'c-alphabet': { creditRating: 'AA+',  creditOutlook: 'stable',    riskFlags: ['regulatory_pressure'] },
  'c-apple':    { creditRating: 'AA+',  creditOutlook: 'stable',    riskFlags: ['regulatory_pressure'] },
  'c-amazon':   { creditRating: 'AA',   creditOutlook: 'stable',    riskFlags: ['regulatory_pressure'] },
  'c-shell':    { creditRating: 'A+',   creditOutlook: 'stable',    riskFlags: ['esg_pressure'] },
  'c-chevron':  { creditRating: 'AA-',  creditOutlook: 'stable',    riskFlags: ['sanctions_adjacent'] },
  'c-northrop': { creditRating: 'BBB+', creditOutlook: 'stable',    riskFlags: [] }
};

const PROSPECT_CREDIT = {
  'pr-aramco':     { creditRating: 'A',    creditOutlook: 'stable',    riskFlags: ['sanctions_adjacent'] },
  'pr-total':      { creditRating: 'A',    creditOutlook: 'stable',    riskFlags: ['esg_pressure'] },
  'pr-stellantis': { creditRating: 'BBB',  creditOutlook: 'negative',  riskFlags: ['distressed'] },
  'pr-sanofi':     { creditRating: 'AA-',  creditOutlook: 'stable',    riskFlags: ['litigation_heavy'] },
  'pr-pfizer':     { creditRating: 'A+',   creditOutlook: 'stable',    riskFlags: ['litigation_heavy'] },
  'pr-gm':         { creditRating: 'BBB',  creditOutlook: 'stable',    riskFlags: ['regulatory_pressure'] },
  'pr-az':         { creditRating: 'A',    creditOutlook: 'stable',    riskFlags: [] },
  'pr-ford':       { creditRating: 'BBB-', creditOutlook: 'negative',  riskFlags: ['distressed', 'regulatory_pressure'] },
  'pr-toyota':     { creditRating: 'A+',   creditOutlook: 'stable',    riskFlags: [] },
  'pr-anthropic':  { creditRating: 'NR',   creditOutlook: 'n/a',       riskFlags: ['regulatory_pressure'] },
  'pr-openai':     { creditRating: 'NR',   creditOutlook: 'n/a',       riskFlags: ['regulatory_pressure', 'litigation_heavy'] },
  'pr-bytedance':  { creditRating: 'NR',   creditOutlook: 'n/a',       riskFlags: ['regulatory_pressure', 'sanctions_adjacent'] },
  'pr-tsmc':       { creditRating: 'AA-',  creditOutlook: 'stable',    riskFlags: ['sanctions_adjacent'] },
  'pr-glencore':   { creditRating: 'BBB+', creditOutlook: 'stable',    riskFlags: ['sanctions_adjacent', 'esg_pressure'] },
  'pr-wise':       { creditRating: 'BBB',  creditOutlook: 'stable',    riskFlags: ['regulatory_pressure'] },
  'pr-bae':        { creditRating: 'BBB+', creditOutlook: 'stable',    riskFlags: [] },
  'pr-lockheed':   { creditRating: 'A-',   creditOutlook: 'stable',    riskFlags: [] }
};

function augment(filePath, lookup, label) {
  const list = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let augmented = 0;
  let missing = [];
  for (const entity of list) {
    const enrichment = lookup[entity.id];
    if (!enrichment) {
      missing.push(entity.id);
      // Default for unrecognised IDs — neutral rating, no flags, so the
      // worthiness scorer doesn't blow up. Better than leaving the field
      // undefined.
      entity.creditRating = 'BBB';
      entity.creditOutlook = 'stable';
      entity.riskFlags = [];
      continue;
    }
    entity.creditRating  = enrichment.creditRating;
    entity.creditOutlook = enrichment.creditOutlook;
    entity.riskFlags     = enrichment.riskFlags;
    augmented++;
  }
  fs.writeFileSync(filePath, JSON.stringify(list, null, 2) + '\n');
  console.log(`[backfill-credit] ${label}: ${augmented}/${list.length} entities augmented with credit fields`);
  if (missing.length) {
    console.log(`[backfill-credit] ${label}: ${missing.length} unmapped IDs got neutral defaults: ${missing.join(', ')}`);
  }
}

const clientsPath   = path.join(__dirname, '..', 'data', 'seed', 'clients.json');
const prospectsPath = path.join(__dirname, '..', 'data', 'seed', 'prospects.json');

augment(clientsPath,   CLIENT_CREDIT,   'clients');
augment(prospectsPath, PROSPECT_CREDIT, 'prospects');
