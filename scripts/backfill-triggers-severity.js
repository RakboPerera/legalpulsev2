// One-off backfill: adds triggers[] and severity to opportunities in the
// existing demo-snapshot.json using the same heuristics the bake uses in
// offline mode. Lets the new launch-radar-style fields (mined from
// anthropics/claude-for-legal) show up in the UI without a full re-bake.
//
// Modes:
//   default        — only fill missing fields; idempotent
//   --override     — re-derive triggers AND severity for EVERY opp, even if
//                    valid values exist. Use after tightening the heuristic
//                    (e.g. severity calibration) to see corrected
//                    distribution. Overwrites prior LLM-set values.
//
// Usage:
//   node scripts/backfill-triggers-severity.js
//   node scripts/backfill-triggers-severity.js --override

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { deriveTriggers, deriveSeverity } from './bake-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = path.join(__dirname, '..', 'data', 'demo-snapshot.json');
const OVERRIDE = process.argv.includes('--override');

const raw = fs.readFileSync(SNAPSHOT_PATH, 'utf8');
const snap = JSON.parse(raw);

const opportunities = snap.opportunities || [];
const signals = snap.signals || [];
const signalsById = new Map(signals.map(s => [s.id, s]));

let triggersAdded = 0;
let severityAdded = 0;
const sevBefore = { p0: 0, p1: 0, p2: 0, p3: 0 };
opportunities.forEach(o => { if (sevBefore[o.severity] !== undefined) sevBefore[o.severity]++; });

for (const opp of opportunities) {
  const oppSignals = (opp.basis?.signalIds || [])
    .map(id => signalsById.get(id))
    .filter(Boolean);

  if (OVERRIDE || !Array.isArray(opp.triggers) || opp.triggers.length === 0) {
    opp.triggers = deriveTriggers(oppSignals, opp.suggestedService);
    triggersAdded++;
  }
  if (OVERRIDE || !['p0', 'p1', 'p2', 'p3'].includes(opp.severity)) {
    opp.severity = deriveSeverity(opp.urgencyTier, oppSignals);
    severityAdded++;
  }
}

fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2));

console.log(`${OVERRIDE ? 'Overrode' : 'Backfilled'} ${triggersAdded} triggers and ${severityAdded} severity values across ${opportunities.length} opportunities.`);
if (OVERRIDE) console.log('Severity BEFORE:', sevBefore);

// Tally severity distribution + most common triggers for a sanity check.
const sevCounts = { p0: 0, p1: 0, p2: 0, p3: 0 };
const trigCounts = {};
for (const opp of opportunities) {
  if (opp.severity) sevCounts[opp.severity] = (sevCounts[opp.severity] || 0) + 1;
  for (const t of (opp.triggers || [])) trigCounts[t] = (trigCounts[t] || 0) + 1;
}
console.log('Severity distribution:', sevCounts);
console.log('Trigger distribution:', Object.entries(trigCounts).sort((a, b) => b[1] - a[1]).slice(0, 10));
