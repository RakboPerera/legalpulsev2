// Phase 3 / Change 1 — Demo bake extension: wallet-gap opportunities.
//
// Runs the wallet-gap engine against the seed clients + matters and
// appends the resulting opportunities to data/demo-snapshot.json. Used
// to seed the demo workspace with realistic wallet-gap output without
// running the full bake pipeline.
//
// Why a separate script (not part of bake-demo.js):
//   - Wallet-gap doesn't need any of the bake's expensive ingestion or
//     LLM-agent calls — heuristic only
//   - Lets us re-seed demos cheaply after tweaking the estimator
//   - Doesn't risk corrupting the existing 21-opp baseline
//
// Run with:  node scripts/bake-wallet-gap-opps.js
// Idempotent — re-running replaces existing wallet_gap opps by ID.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runWalletGapEngine } from '../backend/engines/walletGap.js';
import { runGeographicGapEngine } from '../backend/engines/geographicGap.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const seedClientsPath  = path.join(__dirname, '..', 'data', 'seed', 'clients.json');
const seedMattersPath  = path.join(__dirname, '..', 'data', 'seed', 'matters.json');
const snapshotPath     = path.join(__dirname, '..', 'data', 'demo-snapshot.json');

const clients = JSON.parse(fs.readFileSync(seedClientsPath, 'utf8'));
const matters = JSON.parse(fs.readFileSync(seedMattersPath, 'utf8'));
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));

// Construct a minimal workspace for the engine to read. auditTrail
// gets a new array — the script-side writes go through addAuditEntry
// but we discard them (the engine's audit entries shouldn't pollute
// the snapshot's auditTrail; only real pipeline runs should add there).
const fakeWorkspace = {
  clients,
  matters,
  auditTrail: []
};

const wgOpps  = await runWalletGapEngine({ workspace: fakeWorkspace, limit: 24 });
const ggOpps  = await runGeographicGapEngine({ workspace: fakeWorkspace, limit: 30 });

// Drop any pre-existing opps from the engines we're about to re-bake.
// Without this, an opportunityId scheme change (e.g. moving country
// from the signalIds slot into the entity-id slot in geographic_gap)
// would leave the OLD ids orphaned in the snapshot alongside the NEW
// ones. The deterministic-merge below only catches collisions on
// identical ids, not "same logical opp, different id format".
const REPLACED_ENGINES = new Set(['wallet_gap', 'geographic_gap']);
const carriedOpps = (snapshot.opportunities || []).filter(o => !REPLACED_ENGINES.has(o.engineSource));
const droppedCount = (snapshot.opportunities || []).length - carriedOpps.length;

// Merge into snapshot.opportunities by ID. Existing wallet_gap /
// geographic_gap opps (same id, deterministic via opportunityId) get
// replaced.
const oppById = new Map(carriedOpps.map(o => [o.id, o]));
let added = 0;
for (const o of [...wgOpps, ...ggOpps]) {
  oppById.set(o.id, o);
  added++;
}
snapshot.opportunities = Array.from(oppById.values());

// Also mirror the seed clients' publicFinancials into the snapshot
// clients so the demo workspace's KPI dashboard can compute the
// roll-up without depending on the seed-merge fallback at load time.
const seedClientById = new Map(clients.map(c => [c.id, c]));
snapshot.clients = (snapshot.clients || []).map(sc => {
  const fromSeed = seedClientById.get(sc.id);
  if (!fromSeed?.publicFinancials) return sc;
  return { ...sc, publicFinancials: fromSeed.publicFinancials };
});

snapshot.bakedAt = new Date().toISOString();

fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n');

console.log(`[bake-wallet-gap] ${wgOpps.length} wallet-gap + ${ggOpps.length} geographic-gap emitted`);
console.log(`[bake-wallet-gap] ${droppedCount} prior opps from these engines removed before re-bake`);
console.log(`[bake-wallet-gap] ${added} opportunities placed into snapshot`);
console.log(`[bake-wallet-gap] total opportunities in snapshot: ${snapshot.opportunities.length}`);
console.log(`[bake-wallet-gap] clients with publicFinancials: ${snapshot.clients.filter(c => c.publicFinancials).length} / ${snapshot.clients.length}`);
