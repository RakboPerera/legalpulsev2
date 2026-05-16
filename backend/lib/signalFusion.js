// Cross-source signal fusion. A senior partner reading market data treats
// three signals from three DIFFERENT sources reporting the same underlying
// event (e.g. EDGAR 8-K + GDELT news + CourtListener docket) as one strong
// signal — not three weak ones. This module annotates each signal with the
// size and source-diversity of the cluster it belongs to, so downstream
// agents can weight evidence accordingly.
//
// Group key: (primaryEntityId, ISO-week, eventTopic). Signals without an
// entity link or topic don't fuse — they pass through as singletons.

function isoWeekKey(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  // ISO-8601 week number computation. Approximation good enough for fusion.
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7; // Mon=0
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = (target - firstThursday) / 86400000;
  const week = 1 + Math.floor(diff / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function primaryEntityId(sig) {
  const e = (sig.entities || []).find(x => x.entityId);
  return e?.entityId || null;
}

export function annotateFusion(signals) {
  if (!Array.isArray(signals)) return signals;
  // Build cluster index.
  const clusters = new Map(); // key -> { id, signals: [], sources: Set }
  let cid = 0;
  for (const s of signals) {
    const ent = primaryEntityId(s);
    const week = isoWeekKey(s.publishedAt);
    const topic = s.eventTopic || 'general';
    if (!ent || !week) continue;
    const key = `${ent}|${week}|${topic}`;
    if (!clusters.has(key)) {
      clusters.set(key, {
        id: `fg-${cid++}-${ent}`,
        key,
        entityId: ent,
        week,
        topic,
        signals: [],
        sources: new Set()
      });
    }
    const c = clusters.get(key);
    c.signals.push(s);
    if (s.source) c.sources.add(s.source);
  }

  // Annotate each signal with fusion metadata. Singleton signals (clusters of
  // size 1) get fusionGroupSize=1, fusionSourceCount=1 — i.e. "no
  // corroboration", so the composer doesn't over-rate them.
  for (const c of clusters.values()) {
    if (c.signals.length < 2) continue;
    for (const s of c.signals) {
      s.fusionGroupId = c.id;
      s.fusionGroupSize = c.signals.length;
      s.fusionSourceCount = c.sources.size;
      s.fusionTopic = c.topic;
    }
  }

  // For unfused signals, set defaults so the field shape is consistent.
  for (const s of signals) {
    if (s.fusionGroupSize == null) {
      s.fusionGroupSize = 1;
      s.fusionSourceCount = 1;
    }
  }

  return signals;
}

// Helper for the composer / event engine: given a set of signals (already
// annotated), return aggregate strength metrics describing the underlying
// evidence base.
export function computeFusionStrength(signals) {
  if (!signals?.length) return { avgGroupSize: 0, maxGroupSize: 0, distinctSources: 0, distinctFusionGroups: 0 };
  const sources = new Set();
  const groups = new Set();
  let total = 0;
  let max = 0;
  for (const s of signals) {
    if (s.source) sources.add(s.source);
    if (s.fusionGroupId) groups.add(s.fusionGroupId);
    const sz = s.fusionGroupSize || 1;
    total += sz;
    if (sz > max) max = sz;
  }
  return {
    avgGroupSize: total / signals.length,
    maxGroupSize: max,
    distinctSources: sources.size,
    distinctFusionGroups: groups.size || signals.length
  };
}
