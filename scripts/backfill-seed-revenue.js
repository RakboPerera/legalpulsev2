// Phase 3 / Change 1a — Revenue backfill for the wallet-share gap engine.
//
// Adds publicFinancials = { revenueGbp, fiscalYear, source, retrievedAt }
// to each client in data/seed/clients.json. Used by the walletEstimator
// (backend/lib/walletEstimator.js) to compute an estimated total legal
// spend per client (revenue × sector benchmark).
//
// Why hardcoded:
//   - The 24 demo clients are real public companies with stable, well-
//     known annual revenue. A hardcoded lookup is deterministic, fast,
//     and dependency-free — no live API, no LLM, no per-bake variance.
//   - For a real-firm onboarding the source switches to live filings
//     (EDGAR financials API) — separate engineering, separate scope.
//
// All figures normalised to GBP using approximate FY 2024 cross-rates
// (USD 0.79, EUR 0.85, DKK 0.114). Values are illustrative for the
// demo; precise to ~5% of published figures. Source column documents
// the public filing the figure came from.
//
// Run with:  node scripts/backfill-seed-revenue.js
// Idempotent — re-running overwrites with the same values.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Revenue figures in GBP millions (rounded). Fiscal year is the most
// recent completed FY at time of bake. "source" is the public filing
// or canonical disclosure the figure came from.
const REVENUE_GBP_M = {
  'c-bp':        { revenueGbp: 152_000_000_000, fiscalYear: 2024, source: 'BP plc Annual Report 2024 (Form 20-F)' },
  'c-hsbc':      { revenueGbp:  52_000_000_000, fiscalYear: 2024, source: 'HSBC Holdings Annual Report 2024' },
  'c-maersk':    { revenueGbp:  45_000_000_000, fiscalYear: 2024, source: 'A.P. Moller-Maersk Annual Report 2024' },
  'c-vw':        { revenueGbp: 269_000_000_000, fiscalYear: 2024, source: 'Volkswagen AG Annual Report 2024' },
  'c-asml':      { revenueGbp:  23_500_000_000, fiscalYear: 2024, source: 'ASML Annual Report 2024 (Form 20-F)' },
  'c-rolls':     { revenueGbp:  17_800_000_000, fiscalYear: 2024, source: 'Rolls-Royce Annual Report 2024' },
  'c-vodafone':  { revenueGbp:  31_400_000_000, fiscalYear: 2024, source: 'Vodafone Group Annual Report FY24' },
  'c-exxon':     { revenueGbp: 271_000_000_000, fiscalYear: 2024, source: 'Exxon Mobil 10-K 2024' },
  'c-boeing':    { revenueGbp:  52_000_000_000, fiscalYear: 2024, source: 'Boeing 10-K 2024' },
  'c-gs':        { revenueGbp:  40_500_000_000, fiscalYear: 2024, source: 'Goldman Sachs 10-K 2024' },
  'c-jpm':       { revenueGbp: 137_000_000_000, fiscalYear: 2024, source: 'JPMorgan Chase 10-K 2024' },
  'c-msft':      { revenueGbp: 195_000_000_000, fiscalYear: 2024, source: 'Microsoft 10-K FY24' },
  'c-citi':      { revenueGbp:  64_000_000_000, fiscalYear: 2024, source: 'Citigroup 10-K 2024' },
  'c-bofa':      { revenueGbp:  77_000_000_000, fiscalYear: 2024, source: 'Bank of America 10-K 2024' },
  'c-ms':        { revenueGbp:  47_300_000_000, fiscalYear: 2024, source: 'Morgan Stanley 10-K 2024' },
  'c-barclays':  { revenueGbp:  26_800_000_000, fiscalYear: 2024, source: 'Barclays plc Annual Report 2024' },
  'c-gsk':       { revenueGbp:  31_400_000_000, fiscalYear: 2024, source: 'GSK plc Annual Report 2024' },
  'c-merck':     { revenueGbp:  50_300_000_000, fiscalYear: 2024, source: 'Merck & Co. 10-K 2024' },
  'c-alphabet':  { revenueGbp: 270_000_000_000, fiscalYear: 2024, source: 'Alphabet Inc. 10-K 2024' },
  'c-apple':     { revenueGbp: 304_000_000_000, fiscalYear: 2024, source: 'Apple Inc. 10-K FY24' },
  'c-amazon':    { revenueGbp: 504_000_000_000, fiscalYear: 2024, source: 'Amazon.com 10-K 2024' },
  'c-shell':     { revenueGbp: 219_000_000_000, fiscalYear: 2024, source: 'Shell plc Annual Report 2024' },
  'c-chevron':   { revenueGbp: 154_000_000_000, fiscalYear: 2024, source: 'Chevron Corporation 10-K 2024' },
  'c-northrop':  { revenueGbp:  32_400_000_000, fiscalYear: 2024, source: 'Northrop Grumman 10-K 2024' }
};

const clientsPath = path.join(__dirname, '..', 'data', 'seed', 'clients.json');
const clients = JSON.parse(fs.readFileSync(clientsPath, 'utf8'));

const now = new Date().toISOString();
let added = 0;
let updated = 0;
let missing = 0;
const unknown = [];

for (const client of clients) {
  const entry = REVENUE_GBP_M[client.id];
  if (!entry) {
    missing++;
    unknown.push(client.id);
    continue;
  }
  const before = client.publicFinancials;
  client.publicFinancials = {
    revenueGbp: entry.revenueGbp,
    fiscalYear: entry.fiscalYear,
    source: entry.source,
    retrievedAt: now
  };
  if (before) updated++;
  else added++;
}

fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2) + '\n');

console.log(`[backfill-revenue] ${added} added · ${updated} updated · ${missing} missing`);
if (unknown.length) {
  console.warn(`[backfill-revenue] no revenue mapping for: ${unknown.join(', ')}`);
}
const total = Object.values(REVENUE_GBP_M).reduce((s, x) => s + x.revenueGbp, 0);
console.log(`[backfill-revenue] portfolio revenue total: £${(total / 1e9).toFixed(0)}bn across ${added + updated} clients`);
