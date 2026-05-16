// One-shot hygiene fixes on seed JSON. Idempotent.
//   node scripts/fix-seed-hygiene.cjs
//
// #47 Microsoft partner roster — add p-chandrasekhar (competition / regulatory)
//     so the UK CMA antitrust opportunity can credibly suggest a partner
//     rather than dodging the question. Keeps p-vasquez (IP) as primary.
// #48 Sanofi developer note — strip the `discoveryRationale` field that
//     leaks the seed-staging process ("Moved from client roster to
//     prospects to surface event-driven external opportunities.") into
//     partner-visible audit/explanation surfaces.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CLIENTS = path.join(ROOT, 'data/seed/clients.json');
const PROSPECTS = path.join(ROOT, 'data/seed/prospects.json');
const SNAP = path.join(ROOT, 'data/demo-snapshot.json');

const stats = {
  msPartnerAdded: false,
  sanofiNoteStripped: false,
  snapMsPartnerAdded: false,
  snapSanofiNoteStripped: false,
  capFixed: 0
};

// --- Microsoft: additional partners ---
const clients = JSON.parse(fs.readFileSync(CLIENTS, 'utf8'));
const ms = clients.find(c => c.id === 'c-msft');
if (ms) {
  const additional = Array.isArray(ms.additionalPartners) ? ms.additionalPartners : [];
  if (!additional.includes('p-chandrasekhar')) {
    additional.push('p-chandrasekhar');
    ms.additionalPartners = additional;
    stats.msPartnerAdded = true;
  }
}
fs.writeFileSync(CLIENTS, JSON.stringify(clients, null, 2) + '\n', 'utf8');

// --- Sanofi: strip developer note ---
const prospects = JSON.parse(fs.readFileSync(PROSPECTS, 'utf8'));
const sanofi = prospects.find(p => p.id === 'pr-sanofi');
if (sanofi) {
  if (sanofi.discoveryRationale && /reclassified|moved from client roster|surface event-driven/i.test(sanofi.discoveryRationale)) {
    delete sanofi.discoveryRationale;
    stats.sanofiNoteStripped = true;
  }
  if (sanofi.discoverySource === 'reclassified_from_client') {
    delete sanofi.discoverySource;
    stats.sanofiNoteStripped = true;
  }
}
fs.writeFileSync(PROSPECTS, JSON.stringify(prospects, null, 2) + '\n', 'utf8');

// --- Mirror the changes into the baked snapshot ---
// `reloadDemoSnapshot` reads snapshot.prospects / snapshot.clients and lets
// them override the seed JSONs. Without patching the snapshot too, the seed
// edits would silently get clobbered on reload. Idempotent.
if (fs.existsSync(SNAP)) {
  const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
  const snapMs = (snap.clients || []).find(c => c.id === 'c-msft');
  if (snapMs) {
    const additional = Array.isArray(snapMs.additionalPartners) ? snapMs.additionalPartners : [];
    if (!additional.includes('p-chandrasekhar')) {
      additional.push('p-chandrasekhar');
      snapMs.additionalPartners = additional;
      stats.snapMsPartnerAdded = true;
    }
  }
  const snapSanofi = (snap.prospects || []).find(p => p.id === 'pr-sanofi');
  if (snapSanofi) {
    if (snapSanofi.discoveryRationale && /reclassified|moved from client roster|surface event-driven/i.test(snapSanofi.discoveryRationale)) {
      delete snapSanofi.discoveryRationale;
      stats.snapSanofiNoteStripped = true;
    }
    if (snapSanofi.discoverySource === 'reclassified_from_client') {
      delete snapSanofi.discoverySource;
      stats.snapSanofiNoteStripped = true;
    }
  }
  // Cosmetic: lowercase "the firm's" after a period reads as a typo. Fix
  // it in any talking point or detailedExplanation that got that pattern
  // from the Stellantis (or future) credential scrub.
  const fixCap = s => {
    if (typeof s !== 'string') return s;
    const next = s.replace(/([.!?])\s+the\s+firm/g, '$1 The firm');
    if (next !== s) stats.capFixed++;
    return next;
  };
  for (const b of snap.briefings || []) {
    if (b.basis?.detailedExplanation) b.basis.detailedExplanation = fixCap(b.basis.detailedExplanation);
    for (const tp of b.talkingPoints || []) if (tp.point) tp.point = fixCap(tp.point);
  }
  fs.writeFileSync(SNAP, JSON.stringify(snap, null, 2) + '\n', 'utf8');
}

console.log('Seed hygiene applied.');
console.log(JSON.stringify(stats, null, 2));
