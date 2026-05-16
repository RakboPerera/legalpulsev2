// Second snapshot polish pass. Idempotent. Run after fix-snapshot-quality.
//   node scripts/fix-snapshot-polish.cjs
//
// Handles:
//   #18 stagger generatedAt across a 14-day window (recency-weighted)
//   #26 add bounded noise to estimatedRevenue so values stop looking enum-like
//   #27 collapse genuine duplicate opportunities (same entity + same service)
//   #30 rename internal `changedBy` values (manual_llm_rewrite etc.) to neutral labels
//   #31 delete dev scratch files in data/
//   #32 empty seeded chatHistory

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SNAP = path.join(ROOT, 'data/demo-snapshot.json');

const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8'));

const stats = {
  duplicatesMerged: 0,
  revenueAdjusted: 0,
  timestampsRestaggered: 0,
  changedByRenamed: 0,
  chatEntriesCleared: 0,
  scratchFilesDeleted: 0
};

// ---------- #27 Collapse duplicate opportunities (same entity + same service) ----------
//
// When the bake produced two opps with identical (entity, suggestedService) we
// keep the one with the higher score/confidence and drop the other (plus its
// briefing). The two are functionally the same card to a partner.
{
  const groups = new Map();
  for (const o of snap.opportunities || []) {
    const key = `${o.entity || o.entityId || o.subjectId || ''}::${o.suggestedService || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }
  const removedOppIds = new Set();
  for (const [, list] of groups) {
    if (list.length <= 1) continue;
    // Sort by score desc, then confidence desc — keep [0], drop the rest.
    list.sort((a, b) => (b.score || 0) - (a.score || 0) || (b.confidence || 0) - (a.confidence || 0));
    for (let i = 1; i < list.length; i++) removedOppIds.add(list[i].id);
  }
  if (removedOppIds.size) {
    snap.opportunities = snap.opportunities.filter(o => !removedOppIds.has(o.id));
    snap.briefings = (snap.briefings || []).filter(b => !removedOppIds.has(b.opportunityId));
    stats.duplicatesMerged = removedOppIds.size;
  }
}

// ---------- #26 Bounded noise on estimatedRevenue ----------
//
// Add ±7–18% deterministic noise (keyed by opp id) and round to the nearest
// 25k. We avoid randomness so the snapshot is reproducible across runs.
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}
for (const o of snap.opportunities || []) {
  if (typeof o.estimatedRevenue !== 'number' || o.estimatedRevenue <= 0) continue;
  const h = hashStr(o.id);
  // Already-noised values would round to non-25k multiples — skip them.
  if (o.estimatedRevenue % 25000 !== 0 || o.estimatedRevenue % 100000 !== 0) continue;
  const sign = (h & 1) ? 1 : -1;
  const pct = 7 + ((h >> 1) % 12);          // 7…18%
  const delta = Math.round((o.estimatedRevenue * pct) / 100);
  const noisy = Math.max(50000, o.estimatedRevenue + sign * delta);
  // Round to nearest 25k (still feels human, no longer the 100k/500k enum).
  const rounded = Math.round(noisy / 25000) * 25000;
  if (rounded !== o.estimatedRevenue) {
    o.estimatedRevenue = rounded;
    stats.revenueAdjusted++;
  }
}

// ---------- #18 Stagger generatedAt across a recency-weighted window ----------
//
// Anchor the most recent briefing at the existing snapshot bake time. Spread
// the rest deterministically over the last 14 days, with a logarithmic bias
// so partner-readable "this morning / yesterday" stays plausible.
{
  const anchorMs = snap.bakedAt ? Date.parse(snap.bakedAt) : (snap.briefings?.[0]?.generatedAt ? Date.parse(snap.briefings[0].generatedAt) : Date.now());
  const briefings = [...(snap.briefings || [])].sort((a, b) => {
    const ax = (a.basis?.oneLineHeadline || '') + a.id;
    const bx = (b.basis?.oneLineHeadline || '') + b.id;
    return hashStr(ax) - hashStr(bx);
  });
  for (let i = 0; i < briefings.length; i++) {
    const b = briefings[i];
    // Weight: ~30% within last 24h, ~50% within 1-5 days, ~20% 5-14 days.
    const u = (hashStr(b.id + 'time') % 10000) / 10000; // 0..1
    let daysAgo;
    if (u < 0.30) daysAgo = u * 1.0 / 0.30;                 // 0–1
    else if (u < 0.80) daysAgo = 1 + ((u - 0.30) / 0.50) * 4; // 1–5
    else daysAgo = 5 + ((u - 0.80) / 0.20) * 9;             // 5–14
    const hoursJitter = (hashStr(b.id + 'jitter') % 240) / 10; // 0–24
    const minutesJitter = (hashStr(b.id + 'min') % 60);
    const ts = anchorMs - (daysAgo * 86400000) - (hoursJitter * 3600000) - (minutesJitter * 60000);
    const iso = new Date(ts).toISOString();
    if (b.generatedAt !== iso) {
      b.generatedAt = iso;
      stats.timestampsRestaggered++;
    }
  }
  // Apply matching generatedAt to opportunities, but jitter slightly earlier
  // so the briefing always trails the opp creation by a few minutes.
  const briefByOpp = new Map(briefings.map(b => [b.opportunityId, b.generatedAt]));
  for (const o of snap.opportunities || []) {
    const bts = briefByOpp.get(o.id);
    if (!bts) continue;
    const ts = Date.parse(bts) - (5 + (hashStr(o.id) % 25)) * 60000;
    o.generatedAt = new Date(ts).toISOString();
  }
}

// ---------- #30 Rename internal `changedBy` values ----------
const CHANGED_BY_MAP = {
  manual_llm_rewrite: 'user',
  manual_expand: 'user',
  manual_data_patch: 'user'
};
for (const o of snap.opportunities || []) {
  for (const h of o.statusHistory || []) {
    if (h && CHANGED_BY_MAP[h.changedBy]) {
      h.changedBy = CHANGED_BY_MAP[h.changedBy];
      stats.changedByRenamed++;
    }
  }
}
// Audit-trail actor field can carry the same internal labels.
for (const a of snap.auditTrail || []) {
  if (a && CHANGED_BY_MAP[a.actor]) {
    a.actor = CHANGED_BY_MAP[a.actor];
    stats.changedByRenamed++;
  }
}

// ---------- #32 Clear seeded chatHistory ----------
if (Array.isArray(snap.chatHistory) && snap.chatHistory.length) {
  stats.chatEntriesCleared = snap.chatHistory.length;
  snap.chatHistory = [];
}

// ---------- Write snapshot ----------
fs.writeFileSync(SNAP, JSON.stringify(snap, null, 2) + '\n', 'utf8');

// ---------- #31 Delete scratch files in data/ ----------
const SCRATCH_PATTERNS = [
  /^_[A-Za-z0-9]/,            // _lp.txt, _opps.json, ...
  /^tmp-/i,
  /\.backup-pre-/i,
  /\.backup$/i,
  /^scratch-/i
];
const dataDir = path.join(ROOT, 'data');
for (const f of fs.readdirSync(dataDir)) {
  if (SCRATCH_PATTERNS.some(re => re.test(f))) {
    const p = path.join(dataDir, f);
    if (fs.statSync(p).isFile()) {
      fs.unlinkSync(p);
      stats.scratchFilesDeleted++;
    }
  }
}

console.log('Snapshot polish applied.');
console.log(JSON.stringify(stats, null, 2));
console.log('Opportunities:', snap.opportunities.length, '| Briefings:', snap.briefings.length);
