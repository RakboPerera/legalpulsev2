// Phase 3 / Change 2 — Subsidiary backfill for the demo.
//
// Adds linkedSubsidiaries[] to each client in data/seed/clients.json
// and mirrors the same field onto data/demo-snapshot.json clients so
// the demo workspace shows linked subsidiaries on ClientDetail.
//
// Source of truth: the 24 demo clients are real public companies with
// well-known subsidiary structures from their most recent annual reports
// (10-K Exhibit 21 / Companies House group accounts). The data here is
// public knowledge — illustrative for the demo, with ~5-15 representative
// subsidiaries per client.
//
// For a real-firm deployment the source switches to a live EDGAR
// Exhibit 21 + Companies House PSC scrape — that work lives in
// backend/sources/{edgar,companiesHouse}.js (stub fetcher functions
// would be added there). The product UI is identical either way.
//
// Each subsidiary record:
//   { name, jurisdiction, discoveredVia }
//
// Run with:  node scripts/backfill-seed-subsidiaries.js
// Idempotent.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Subsidiary mappings — illustrative, drawn from public filings.
// "discoveredVia" tracks which public source the entry came from in a
// real deployment ("edgar_exhibit_21" for US filers, "companies_house_psc"
// for UK filers, "annual_report" for non-US/UK).
const SUBSIDIARIES = {
  'c-bp': [
    { name: 'BP America Inc.',           jurisdiction: 'USA',    discoveredVia: 'edgar_exhibit_21' },
    { name: 'BP Exploration Operating Company Limited', jurisdiction: 'UK', discoveredVia: 'companies_house_psc' },
    { name: 'BP Pipelines (Alaska) Inc.', jurisdiction: 'USA',    discoveredVia: 'edgar_exhibit_21' },
    { name: 'BP Trading Limited',        jurisdiction: 'UK',     discoveredVia: 'companies_house_psc' },
    { name: 'Castrol Limited',           jurisdiction: 'UK',     discoveredVia: 'companies_house_psc' },
    { name: 'BP Chemicals Limited',      jurisdiction: 'UK',     discoveredVia: 'companies_house_psc' },
    { name: 'BP Solar International Inc.', jurisdiction: 'USA',  discoveredVia: 'edgar_exhibit_21' },
    { name: 'Lightsource bp Renewable Energy Investments Ltd', jurisdiction: 'UK', discoveredVia: 'companies_house_psc' },
    { name: 'BP Wind Energy North America Inc.', jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'BP Lubricants USA Inc.',    jurisdiction: 'USA',    discoveredVia: 'edgar_exhibit_21' },
    { name: 'BP Capital Markets plc',    jurisdiction: 'UK',     discoveredVia: 'companies_house_psc' },
    { name: 'BP Shipping Limited',       jurisdiction: 'UK',     discoveredVia: 'companies_house_psc' },
    { name: 'Atlantic Methanol Production Company LLC', jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Air BP Limited',            jurisdiction: 'UK',     discoveredVia: 'companies_house_psc' }
  ],
  'c-hsbc': [
    { name: 'HSBC Bank plc',                 jurisdiction: 'UK',  discoveredVia: 'companies_house_psc' },
    { name: 'HSBC USA Inc.',                 jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'HSBC Bank USA, National Association', jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'The Hongkong and Shanghai Banking Corporation Limited', jurisdiction: 'Hong Kong', discoveredVia: 'annual_report' },
    { name: 'HSBC Bank Canada',              jurisdiction: 'Canada', discoveredVia: 'annual_report' },
    { name: 'HSBC Private Bank (Suisse) SA', jurisdiction: 'Switzerland', discoveredVia: 'annual_report' },
    { name: 'HSBC Securities (USA) Inc.',    jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'HSBC Trinkaus & Burkhardt AG',  jurisdiction: 'EU', discoveredVia: 'annual_report' },
    { name: 'HSBC Continental Europe',       jurisdiction: 'EU', discoveredVia: 'annual_report' },
    { name: 'HSBC Investment Bank Holdings Limited', jurisdiction: 'UK', discoveredVia: 'companies_house_psc' }
  ],
  'c-maersk': [
    { name: 'Maersk Line A/S',              jurisdiction: 'Denmark', discoveredVia: 'annual_report' },
    { name: 'APM Terminals B.V.',           jurisdiction: 'EU',      discoveredVia: 'annual_report' },
    { name: 'Maersk Tankers A/S',           jurisdiction: 'Denmark', discoveredVia: 'annual_report' },
    { name: 'Maersk Oil Trading A/S',       jurisdiction: 'Denmark', discoveredVia: 'annual_report' },
    { name: 'Damco International A/S',      jurisdiction: 'Denmark', discoveredVia: 'annual_report' },
    { name: 'Maersk Container Industry A/S', jurisdiction: 'Denmark', discoveredVia: 'annual_report' },
    { name: 'Maersk Supply Service A/S',    jurisdiction: 'Denmark', discoveredVia: 'annual_report' }
  ],
  'c-vw': [
    { name: 'Audi AG',                      jurisdiction: 'EU', discoveredVia: 'annual_report' },
    { name: 'Porsche AG',                   jurisdiction: 'EU', discoveredVia: 'annual_report' },
    { name: 'SEAT, S.A.',                   jurisdiction: 'EU', discoveredVia: 'annual_report' },
    { name: 'Škoda Auto a.s.',              jurisdiction: 'EU', discoveredVia: 'annual_report' },
    { name: 'Volkswagen Financial Services AG', jurisdiction: 'EU', discoveredVia: 'annual_report' },
    { name: 'Volkswagen of America, Inc.',  jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'MAN SE',                       jurisdiction: 'EU', discoveredVia: 'annual_report' },
    { name: 'TRATON SE',                    jurisdiction: 'EU', discoveredVia: 'annual_report' },
    { name: 'Volkswagen Group of America Investments LLC', jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' }
  ],
  'c-asml': [
    { name: 'ASML US LLC',                  jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'ASML Netherlands B.V.',        jurisdiction: 'EU',  discoveredVia: 'annual_report' },
    { name: 'ASML Hong Kong Limited',       jurisdiction: 'Hong Kong', discoveredVia: 'annual_report' },
    { name: 'Cymer LLC',                    jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Hermes Microvision Inc.',      jurisdiction: 'Taiwan', discoveredVia: 'annual_report' }
  ],
  'c-rolls': [
    { name: 'Rolls-Royce plc',              jurisdiction: 'UK', discoveredVia: 'companies_house_psc' },
    { name: 'Rolls-Royce Power Systems AG', jurisdiction: 'EU', discoveredVia: 'annual_report' },
    { name: 'Rolls-Royce North America Inc.', jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Rolls-Royce Civil Nuclear SAS', jurisdiction: 'EU',  discoveredVia: 'annual_report' },
    { name: 'Rolls-Royce SMR Limited',      jurisdiction: 'UK', discoveredVia: 'companies_house_psc' },
    { name: 'Rolls-Royce Marine North America Inc.', jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' }
  ],
  'c-vodafone': [
    { name: 'Vodafone Limited',             jurisdiction: 'UK', discoveredVia: 'companies_house_psc' },
    { name: 'Vodafone Italia S.p.A.',       jurisdiction: 'EU', discoveredVia: 'annual_report' },
    { name: 'Vodafone Spain, S.A.',         jurisdiction: 'EU', discoveredVia: 'annual_report' },
    { name: 'Vodafone Germany GmbH',        jurisdiction: 'EU', discoveredVia: 'annual_report' },
    { name: 'Vodafone Idea Limited',        jurisdiction: 'India', discoveredVia: 'annual_report' },
    { name: 'Vodafone Egypt Telecommunications S.A.E.', jurisdiction: 'Egypt', discoveredVia: 'annual_report' },
    { name: 'VodafoneThree UK Limited',     jurisdiction: 'UK', discoveredVia: 'companies_house_psc' },
    { name: 'Vodacom Group Limited',        jurisdiction: 'South Africa', discoveredVia: 'annual_report' }
  ],
  'c-exxon': [
    { name: 'ExxonMobil Production Company', jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'ExxonMobil Refining & Supply Company', jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Exxon Mobil Chemical Company',  jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'ExxonMobil Pipeline Company',   jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'ExxonMobil Catalysts and Licensing LLC', jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Esso Italiana S.r.l.',          jurisdiction: 'EU',  discoveredVia: 'edgar_exhibit_21' },
    { name: 'Esso Petroleum Company, Limited', jurisdiction: 'UK', discoveredVia: 'edgar_exhibit_21' },
    { name: 'ExxonMobil Asia Pacific Pte. Ltd.', jurisdiction: 'Singapore', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Pioneer Natural Resources Company', jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'ExxonMobil Canada Ltd.',        jurisdiction: 'Canada', discoveredVia: 'edgar_exhibit_21' }
  ],
  'c-boeing': [
    { name: 'Boeing Commercial Airplanes Group', jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Boeing Defense, Space & Security', jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Boeing Capital Corporation',    jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Boeing Global Services',        jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Spirit AeroSystems Holdings, Inc.', jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Insitu, Inc.',                  jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Aurora Flight Sciences Corporation', jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' }
  ],
  'c-gs': [
    { name: 'Goldman Sachs Bank USA',        jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Goldman Sachs International',   jurisdiction: 'UK',  discoveredVia: 'companies_house_psc' },
    { name: 'Goldman Sachs & Co. LLC',       jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Goldman Sachs Asset Management, L.P.', jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Marcus by Goldman Sachs',       jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Goldman Sachs Japan Co., Ltd.', jurisdiction: 'Japan', discoveredVia: 'edgar_exhibit_21' }
  ],
  'c-jpm': [
    { name: 'JPMorgan Chase Bank, N.A.',     jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'J.P. Morgan Securities LLC',    jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'J.P. Morgan Securities plc',    jurisdiction: 'UK',  discoveredVia: 'companies_house_psc' },
    { name: 'J.P. Morgan AG',                jurisdiction: 'EU',  discoveredVia: 'edgar_exhibit_21' },
    { name: 'JPMorgan Chase Bank, N.A. (Hong Kong Branch)', jurisdiction: 'Hong Kong', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Chase Bank USA, National Association', jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'J.P. Morgan Asset Management Holdings Inc.', jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' }
  ],
  'c-msft': [
    { name: 'Microsoft Ireland Operations Limited', jurisdiction: 'EU',  discoveredVia: 'edgar_exhibit_21' },
    { name: 'LinkedIn Corporation',          jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'GitHub, Inc.',                  jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Mojang AB',                     jurisdiction: 'EU',  discoveredVia: 'edgar_exhibit_21' },
    { name: 'Activision Blizzard, Inc.',     jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Nuance Communications, Inc.',   jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'ZeniMax Media Inc.',            jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' }
  ],
  'c-citi': [
    { name: 'Citibank, N.A.',                jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Citigroup Global Markets Inc.', jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Citigroup Global Markets Limited', jurisdiction: 'UK', discoveredVia: 'companies_house_psc' },
    { name: 'Banamex (Grupo Financiero Citibanamex)', jurisdiction: 'Mexico', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Citibank Singapore Limited',    jurisdiction: 'Singapore', discoveredVia: 'edgar_exhibit_21' }
  ],
  'c-bofa': [
    { name: 'Bank of America, N.A.',         jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Merrill Lynch, Pierce, Fenner & Smith Incorporated', jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'BofA Securities, Inc.',         jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Merrill Lynch International',   jurisdiction: 'UK',  discoveredVia: 'companies_house_psc' },
    { name: 'Bank of America Merrill Lynch International DAC', jurisdiction: 'EU', discoveredVia: 'edgar_exhibit_21' }
  ],
  'c-ms': [
    { name: 'Morgan Stanley & Co. LLC',      jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Morgan Stanley Bank, N.A.',     jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Morgan Stanley & Co. International plc', jurisdiction: 'UK', discoveredVia: 'companies_house_psc' },
    { name: 'Morgan Stanley Capital Group Inc.', jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Morgan Stanley Investment Management Inc.', jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' }
  ],
  'c-barclays': [
    { name: 'Barclays Bank plc',             jurisdiction: 'UK',  discoveredVia: 'companies_house_psc' },
    { name: 'Barclays Bank UK plc',          jurisdiction: 'UK',  discoveredVia: 'companies_house_psc' },
    { name: 'Barclays Capital Inc.',         jurisdiction: 'USA', discoveredVia: 'companies_house_psc' },
    { name: 'Barclays Bank Ireland plc',     jurisdiction: 'EU',  discoveredVia: 'companies_house_psc' },
    { name: 'Barclays Securities Japan Ltd.', jurisdiction: 'Japan', discoveredVia: 'companies_house_psc' }
  ],
  'c-gsk': [
    { name: 'GlaxoSmithKline LLC',           jurisdiction: 'USA', discoveredVia: 'companies_house_psc' },
    { name: 'GlaxoSmithKline Consumer Healthcare', jurisdiction: 'UK', discoveredVia: 'companies_house_psc' },
    { name: 'GlaxoSmithKline Services Unlimited', jurisdiction: 'UK', discoveredVia: 'companies_house_psc' },
    { name: 'Stiefel Laboratories, Inc.',    jurisdiction: 'USA', discoveredVia: 'companies_house_psc' },
    { name: 'ViiV Healthcare Limited',       jurisdiction: 'UK',  discoveredVia: 'companies_house_psc' }
  ],
  'c-merck': [
    { name: 'Merck Sharp & Dohme Corp.',     jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Organon & Co.',                 jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Merck Sharp & Dohme (Europe), Inc.', jurisdiction: 'EU', discoveredVia: 'edgar_exhibit_21' },
    { name: 'MSD Animal Health',             jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Sirna Therapeutics, Inc.',      jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' }
  ],
  'c-alphabet': [
    { name: 'Google LLC',                    jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'YouTube, LLC',                  jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Google Ireland Limited',        jurisdiction: 'EU',  discoveredVia: 'edgar_exhibit_21' },
    { name: 'Waymo LLC',                     jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'DeepMind Technologies Limited', jurisdiction: 'UK',  discoveredVia: 'edgar_exhibit_21' },
    { name: 'Verily Life Sciences LLC',      jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Wing Aviation LLC',             jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' }
  ],
  'c-apple': [
    { name: 'Apple Operations International Limited', jurisdiction: 'EU', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Apple Distribution International Limited', jurisdiction: 'EU', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Apple Services LATAM LLC',      jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Beats Electronics, LLC',        jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Apple Retail UK Limited',       jurisdiction: 'UK',  discoveredVia: 'edgar_exhibit_21' },
    { name: 'Apple Japan G.K.',              jurisdiction: 'Japan', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Apple Services Singapore Pte. Ltd.', jurisdiction: 'Singapore', discoveredVia: 'edgar_exhibit_21' }
  ],
  'c-amazon': [
    { name: 'Amazon Services LLC',           jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Amazon Web Services, Inc.',     jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Whole Foods Market, Inc.',      jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Twitch Interactive, Inc.',      jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Amazon EU SARL',                jurisdiction: 'EU',  discoveredVia: 'edgar_exhibit_21' },
    { name: 'Amazon UK Services Ltd.',       jurisdiction: 'UK',  discoveredVia: 'edgar_exhibit_21' },
    { name: 'Ring LLC',                      jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'MGM Holdings Inc.',             jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Amazon Japan G.K.',             jurisdiction: 'Japan', discoveredVia: 'edgar_exhibit_21' }
  ],
  'c-shell': [
    { name: 'Shell Petroleum N.V.',          jurisdiction: 'EU',  discoveredVia: 'companies_house_psc' },
    { name: 'Shell USA, Inc.',               jurisdiction: 'USA', discoveredVia: 'companies_house_psc' },
    { name: 'Shell Chemicals Limited',       jurisdiction: 'UK',  discoveredVia: 'companies_house_psc' },
    { name: 'Shell Trading International Limited', jurisdiction: 'UK', discoveredVia: 'companies_house_psc' },
    { name: 'Shell Energy Europe Limited',   jurisdiction: 'UK',  discoveredVia: 'companies_house_psc' },
    { name: 'Shell Marine Products Limited', jurisdiction: 'UK',  discoveredVia: 'companies_house_psc' },
    { name: 'Pennzoil-Quaker State Company', jurisdiction: 'USA', discoveredVia: 'companies_house_psc' },
    { name: 'BG Group Limited',              jurisdiction: 'UK',  discoveredVia: 'companies_house_psc' },
    { name: 'Shell Recharge Solutions B.V.', jurisdiction: 'EU',  discoveredVia: 'companies_house_psc' }
  ],
  'c-chevron': [
    { name: 'Chevron U.S.A. Inc.',           jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Chevron Phillips Chemical Company LLC', jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Chevron Australia Pty Ltd',     jurisdiction: 'Australia', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Chevron Pipe Line Company',     jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Chevron Shipping Company LLC',  jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Hess Corporation',              jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' }
  ],
  'c-northrop': [
    { name: 'Northrop Grumman Systems Corporation', jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Northrop Grumman Innovation Systems LLC', jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Orbital ATK Inc.',              jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Vinnell Corporation',           jurisdiction: 'USA', discoveredVia: 'edgar_exhibit_21' },
    { name: 'Northrop Grumman UK Limited',   jurisdiction: 'UK',  discoveredVia: 'edgar_exhibit_21' }
  ]
};

const seedClientsPath = path.join(__dirname, '..', 'data', 'seed', 'clients.json');
const snapshotPath    = path.join(__dirname, '..', 'data', 'demo-snapshot.json');

const clients  = JSON.parse(fs.readFileSync(seedClientsPath, 'utf8'));
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));

const now = new Date().toISOString();
let totalSubs = 0;
let totalClients = 0;
const unknown = [];

function applyTo(list) {
  let count = 0;
  for (const c of list) {
    const subs = SUBSIDIARIES[c.id];
    if (!subs) {
      unknown.push(c.id);
      continue;
    }
    c.linkedSubsidiaries = subs.map(s => ({ ...s, retrievedAt: now }));
    count++;
  }
  return count;
}

totalClients = applyTo(clients);
applyTo(snapshot.clients || []);
totalSubs = Object.values(SUBSIDIARIES).reduce((s, x) => s + x.length, 0);

snapshot.bakedAt = now;

fs.writeFileSync(seedClientsPath, JSON.stringify(clients, null, 2) + '\n');
fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n');

console.log(`[backfill-subsidiaries] ${totalClients} / ${clients.length} clients carry linked subsidiaries`);
console.log(`[backfill-subsidiaries] ${totalSubs} subsidiary records across the portfolio`);
if (unknown.length) {
  // We have entries for all 24 demo clients but report any drift so a
  // future client addition doesn't quietly skip subsidiary coverage.
  console.warn(`[backfill-subsidiaries] no subsidiary map for: ${[...new Set(unknown)].join(', ')}`);
}
