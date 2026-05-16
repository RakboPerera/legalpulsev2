// Event-cluster extraction. Groups significant signals into "global
// happenings" — distinct underlying events corroborated across sources or
// signal counts. Used in two places:
//
//   1. Bake-time event-driven opportunity engine ("which clients are
//      exposed to each major event this week?")
//   2. Runtime market-screening UI (filter by region/industry/time, surface
//      events for a partner to click through and generate fresh opps from)
//
// The clustering key is (eventTopic, ISO-week). A signal without a topic
// classifies into the topic 'general'. Two signals on different topics in
// the same week stay in different clusters; same topic across weeks stay
// separate so we can surface "Hormuz disruption (week 19)" distinct from
// "Hormuz disruption (week 21)".

function isoWeekKey(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = (target - firstThursday) / 86400000;
  const week = 1 + Math.floor(diff / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function eventKey(topic, week) {
  const t = (topic || 'general').replace(/\s+/g, '_').toLowerCase();
  return `${t}::${week}`;
}

// Topic-quality multiplier for the cluster ranker. The signal classifier
// returns 'general' as the catch-all bucket — those clusters tend to be
// low-precision noise piles, so down-weight them. Named topics (m_and_a,
// force_majeure, ofac_sanctions, etc.) are clear actionable categories
// and get full weight. 'litigation general' is partway between.
function topicSpecificityWeight(topic) {
  if (!topic) return 0.3;
  const t = topic.toLowerCase().replace(/\s+/g, '_');
  if (t === 'general') return 0.3;
  if (t === 'litigation_general') return 0.6;
  return 1.0;
}

// Given the full signal pool and optional filters, return event clusters
// sorted by recency + corroboration strength. Pure function, no LLM.
//
// Filters (all optional):
//   - region: 'USA' | 'UK' | 'EU' | 'Other' | 'all'  — matches signal.jurisdictions
//   - industry: a sector key like 'oil_gas' | 'all'  — matches signal.affectedIndustries
//   - sinceISO: drop signals with publishedAt < sinceISO
//   - limit: max clusters to return (default 50)
//   - onlySignificant: default true — only include signals that passed legal
//     significance classification.
export function extractScreeningEvents(signals, filters = {}) {
  const {
    region = 'all',
    industry = 'all',
    sinceISO = null,
    limit = 50,
    onlySignificant = true
  } = filters;

  const sinceTs = sinceISO ? new Date(sinceISO).getTime() : null;
  const filtered = (signals || []).filter(s => {
    if (onlySignificant && !s.isLegallySignificant) return false;
    if (sinceTs && s.publishedAt && new Date(s.publishedAt).getTime() < sinceTs) return false;
    if (region !== 'all') {
      const sigRegions = s.jurisdictions || [];
      if (region === 'Other') {
        const isMajor = sigRegions.some(r => r === 'USA' || r === 'UK' || r === 'EU');
        if (isMajor) return false;
      } else {
        if (!sigRegions.includes(region)) return false;
      }
    }
    if (industry !== 'all') {
      const inds = s.affectedIndustries || [];
      if (!inds.includes(industry)) return false;
    }
    return true;
  });

  // Cluster by (topic, week)
  const clusters = new Map();
  for (const s of filtered) {
    const week = isoWeekKey(s.publishedAt) || 'unknown';
    const topic = s.eventTopic || 'general';
    const key = eventKey(topic, week);
    if (!clusters.has(key)) {
      clusters.set(key, {
        eventKey: key,
        eventTopic: topic,
        week,
        signals: [],
        sources: new Set(),
        jurisdictions: new Set(),
        industries: new Set(),
        publishedAtMax: null,
        entityIds: new Set()
      });
    }
    const c = clusters.get(key);
    c.signals.push(s);
    if (s.source) c.sources.add(s.source);
    for (const j of (s.jurisdictions || [])) c.jurisdictions.add(j);
    for (const i of (s.affectedIndustries || [])) c.industries.add(i);
    for (const e of (s.entities || [])) if (e.entityId) c.entityIds.add(e.entityId);
    if (s.publishedAt) {
      const t = new Date(s.publishedAt).getTime();
      if (!isNaN(t)) {
        const cur = c.publishedAtMax ? new Date(c.publishedAtMax).getTime() : 0;
        if (t > cur) c.publishedAtMax = s.publishedAt;
      }
    }
  }

  // Filter to "interesting" clusters: multi-source OR multi-signal, OR a
  // single signal that's already in a fusion cluster (signalFusion gave it
  // fusionGroupSize >= 2). A single isolated signal isn't a "global event" —
  // it's just one article.
  const interesting = [];
  for (const c of clusters.values()) {
    const ms = c.signals.length;
    const ss = c.sources.size;
    const inFusion = c.signals.some(s => (s.fusionGroupSize || 1) >= 2);
    if (ms >= 2 || ss >= 2 || inFusion) interesting.push(c);
  }

  // Score: recency (days back from max event date) + source diversity +
  // signal count, multiplied by topic-specificity. Generic 'general' /
  // 'litigation general' clusters are heavily downweighted because they
  // tend to be low-precision noise piles — a 30-signal "general" cluster
  // outranking a 4-signal "patent litigation" cluster is wrong. Named
  // topics (m_and_a, force_majeure, ofac_sanctions, etc.) get full weight.
  const now = Date.now();
  for (const c of interesting) {
    const recencyDays = c.publishedAtMax
      ? Math.max(0, (now - new Date(c.publishedAtMax).getTime()) / 86400000)
      : 60;
    const recencyScore = Math.max(0, 30 - recencyDays); // newer = higher
    const rawScore = recencyScore + (c.sources.size * 5) + (c.signals.length * 2);
    const topicSpecificity = topicSpecificityWeight(c.eventTopic);
    c._score = rawScore * topicSpecificity;
  }
  interesting.sort((a, b) => b._score - a._score);

  // Build the public shape — convert sets to arrays, derive headline.
  return interesting.slice(0, limit).map(c => {
    // Headline: title of the most-recent signal in the cluster.
    const sortedSignals = c.signals.slice().sort((a, b) => {
      const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return tb - ta;
    });
    const top = sortedSignals[0];
    return {
      eventKey: c.eventKey,
      eventTopic: c.eventTopic,
      week: c.week,
      headline: (top?.title || c.eventTopic || 'Untitled event').slice(0, 220),
      summary: (top?.description || '').slice(0, 400),
      signalIds: c.signals.map(s => s.id),
      signalCount: c.signals.length,
      sourceCount: c.sources.size,
      sources: Array.from(c.sources),
      jurisdictions: Array.from(c.jurisdictions),
      industries: Array.from(c.industries),
      entityIds: Array.from(c.entityIds),
      publishedAtMax: c.publishedAtMax,
      score: Math.round(c._score)
    };
  });
}

// Look up the full signal records for an event key. Used by the screening
// route handler to pass real signals into the LLM agent.
export function getEventSignals(signals, eventKey) {
  const target = (signals || []).filter(s => {
    const week = isoWeekKey(s.publishedAt) || 'unknown';
    const topic = s.eventTopic || 'general';
    return `${topic.replace(/\s+/g, '_').toLowerCase()}::${week}` === eventKey;
  });
  return target;
}

// Re-export the key derivation so other modules (bake script) compute it
// consistently.
export { isoWeekKey, eventKey };
