// Reasoning Trail endpoint — a per-signal processing audit.
//
// Single clear purpose: for every signal that entered the pipeline (post
// dedup), tell the partner exactly what the system did with it and why.
// The response is built around two flat ledgers:
//
//   1. signals[]        — every signal × its disposition (used-in-opp,
//                         significant-but-unused, flagged-noise) plus
//                         the per-stage processing trail
//   2. consideredOpportunities — every (entity × service) candidate the
//                         heuristic surfaced, partitioned into surfaced
//                         (passed / demoted) vs rejected (with curated
//                         reason text)
//
// Drives the Reasoning Trail UI (two tabs: Signals · Opportunities considered).
// Replaces an earlier "trust banner + funnel + lineage cards" payload —
// that surface mixed too many narratives. This one is an audit.

import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getWorkspace } from '../lib/workspaceStore.js';
import { requireAuth } from './auth.js';
import { extractScreeningEvents, eventKey, isoWeekKey } from '../lib/eventClusters.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const bakeSummaryPath = path.join(__dirname, '..', '..', 'data', 'bake-summary.json');

function readBakeSummary() {
  try { return JSON.parse(fs.readFileSync(bakeSummaryPath, 'utf8')); }
  catch { return {}; }
}

// === Disposition classification per signal ===
// Four mutually-exclusive states a deduped signal can be in:
//   flagged-noise               — classifier said not legally significant
//   significant-unclustered     — significant but in no cluster (singleton)
//   significant-clustered-unused — significant + in a cluster but cited by no opp
//   used-in-opp                  — cited by at least one workspace.opportunity
// The 124 dedup-dropped signals don't get a row (the loser was discarded
// during dedup) — they're acknowledged only as an aggregate count in the
// header strip.
function classifyDisposition(signal, opUseIndex, clusteredIds) {
  if (!signal.isLegallySignificant) return 'flagged-noise';
  if (opUseIndex.has(signal.id)) return 'used-in-opp';
  if (clusteredIds.has(signal.id)) return 'significant-clustered-unused';
  return 'significant-unclustered';
}

function shapeAuditSignal(s, opUseIndex, clusteredIds, eventByKey, entityNameById) {
  const disposition = classifyDisposition(s, opUseIndex, clusteredIds);
  const topic = s.eventTopic || 'general';
  const week = isoWeekKey(s.publishedAt) || 'unknown';
  const ckey = eventKey(topic, week);
  const cluster = eventByKey.get(ckey);
  const usedIn = opUseIndex.get(s.id) || [];
  return {
    id: s.id,
    source: s.source,
    sourceUrl: s.sourceUrl,
    title: s.title,
    excerpt: (s.description || '').slice(0, 280),
    publishedAt: s.publishedAt,
    ingestionTimestamp: s.ingestionTimestamp,
    entities: (s.entities || []).map(e => ({
      entityId: e.entityId || null,
      entityName: e.entityId ? entityNameById.get(e.entityId) || null : null,
      mentionedAs: e.mentionedAs || null,
      confidence: typeof e.confidence === 'number' ? e.confidence : null
    })),
    jurisdictions: s.jurisdictions || [],
    classification: {
      isLegallySignificant: !!s.isLegallySignificant,
      reason: s.legalSignificanceReason || '',
      classifiedBy: s.classifiedBy || null,
      eventTopic: topic,
      affectedIndustries: s.affectedIndustries || []
    },
    cluster: cluster ? {
      key: ckey,
      topic: cluster.eventTopic,
      week: cluster.week,
      memberCount: cluster.signalCount,
      sourceCount: cluster.sourceCount,
      jurisdictions: cluster.jurisdictions || [],
      industries: cluster.industries || []
    } : null,
    fusion: {
      groupSize: s.fusionGroupSize || 1,
      sourceCount: s.fusionSourceCount || 1
    },
    disposition,
    usedInOppIds: usedIn
  };
}

// === Build the reverse-index: signal id → [opp id] ===
function buildOppUseIndex(opportunities) {
  const idx = new Map();
  for (const o of opportunities || []) {
    for (const sid of (o.basis?.signalIds || [])) {
      const arr = idx.get(sid) || [];
      arr.push(o.id);
      idx.set(sid, arr);
    }
  }
  return idx;
}

// === Surfaced opps (the ones currently on the partner board) ===
function shapeSurfacedOpp(o, entityById) {
  const entity = entityById.get(o.entity);
  const criticIssues = o.basis?.criticIssues || [];
  const isDemoted = o.severity === 'p3' || criticIssues.length > 0;
  return {
    id: o.id,
    entityId: o.entity,
    entityName: entity?.legalName || o.entity,
    entityType: o.entityType,
    service: o.suggestedService,
    engineSource: o.engineSource,
    score: o.score,
    severity: o.severity,
    urgencyTier: o.urgencyTier,
    status: isDemoted ? 'demoted' : 'passed',
    criticIssues,
    summary: o.basis?.summary || '',
    reasoning: o.basis?.reasoning || '',
    signalIds: o.basis?.signalIds || []
  };
}

function shapeRejectedOpp(r, entityById, sigById) {
  // The rejection records include INLINE signal stubs (written by the
  // reconstruction script) — preferred when present, because the
  // heuristic bake's signal IDs don't always exist in the current
  // workspace (different bake runs canonicalise URLs differently).
  // Fall back to hydrating from workspace.signals only when inline data
  // isn't there.
  const signals = (r.signals && r.signals.length)
    ? r.signals
    : (r.signalIds || [])
      .map(id => sigById.get(id))
      .filter(Boolean)
      .map(s => ({
        id: s.id, source: s.source, title: s.title,
        excerpt: (s.description || '').slice(0, 220),
        url: s.sourceUrl, publishedAt: s.publishedAt
      }));
  return {
    id: r.id,
    entityId: r.entity,
    entityName: r.entityName || entityById.get(r.entity)?.legalName || r.entity,
    entityType: r.entityType,
    service: r.service,
    engineSource: r.engineSource,
    originalScore: r.originalScore,
    reasonCode: r.reasonCode,
    reasonLabel: r.reasonLabel,
    reasonText: r.reasonText,
    droppedBy: r.droppedBy,
    droppedAt: r.droppedAt,
    signalIds: r.signalIds || [],
    signals
  };
}

// === Facet counts (computed pre-filter so the chip-bar shows scope) ===
function computeFacets(allSignals, opUseIndex, clusteredIds, entityNameById) {
  const bySource = {};
  const byDisposition = {};
  const byEntity = {};
  for (const s of allSignals) {
    if (s.source) bySource[s.source] = (bySource[s.source] || 0) + 1;
    const d = classifyDisposition(s, opUseIndex, clusteredIds);
    byDisposition[d] = (byDisposition[d] || 0) + 1;
    for (const e of (s.entities || [])) {
      if (e.entityId) {
        const k = e.entityId;
        byEntity[k] = (byEntity[k] || 0) + 1;
      }
    }
  }
  // Hydrate entity facet with names for UI rendering
  const entityFacet = Object.entries(byEntity)
    .map(([id, count]) => ({ id, name: entityNameById.get(id) || id, count }))
    .sort((a, b) => b.count - a.count);
  return { bySource, byDisposition, byEntity: entityFacet };
}

// === Apply filters + paginate ===
function filterAndPaginate(allShaped, params) {
  let rows = allShaped;
  if (params.source && params.source !== 'all') {
    rows = rows.filter(r => r.source === params.source);
  }
  if (params.disposition && params.disposition !== 'all') {
    rows = rows.filter(r => r.disposition === params.disposition);
  }
  if (params.entity && params.entity !== 'all') {
    rows = rows.filter(r => r.entities.some(e => e.entityId === params.entity));
  }
  if (params.q) {
    const q = params.q.toLowerCase();
    rows = rows.filter(r =>
      (r.title || '').toLowerCase().includes(q) ||
      (r.excerpt || '').toLowerCase().includes(q)
    );
  }
  // Sort newest first by default
  rows.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  const total = rows.length;
  const offset = Math.max(0, params.offset);
  const limit = Math.max(1, Math.min(500, params.limit));
  const items = rows.slice(offset, offset + limit);
  return { total, offset, limit, items };
}

export function createReasoningRouter(db) {
  const router = Router();

  router.get('/:id/reasoning', requireAuth, (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });

    const bake = readBakeSummary();
    const allSignals = ws.signals || [];
    const sigById = new Map(allSignals.map(s => [s.id, s]));
    const entityList = [...(ws.clients || []), ...(ws.prospects || [])];
    const entityById = new Map(entityList.map(e => [e.id, e]));
    const entityNameById = new Map(entityList.map(e => [e.id, e.legalName]));

    // Cluster index — every signal in any multi-signal/multi-source/fusion cluster
    const events = extractScreeningEvents(allSignals, { limit: 500 });
    const clusteredIds = new Set();
    const eventByKey = new Map();
    for (const e of events) {
      eventByKey.set(e.eventKey, e);
      for (const id of e.signalIds) clusteredIds.add(id);
    }

    // Reverse-index: signal id → opp ids
    const opUseIndex = buildOppUseIndex(ws.opportunities);

    // Shape every signal once (the audit's "row" object)
    const allShaped = allSignals.map(s =>
      shapeAuditSignal(s, opUseIndex, clusteredIds, eventByKey, entityNameById)
    );

    // Filters + pagination
    const params = {
      source: typeof req.query.source === 'string' ? req.query.source : 'all',
      disposition: typeof req.query.disposition === 'string' ? req.query.disposition : 'all',
      entity: typeof req.query.entity === 'string' ? req.query.entity : 'all',
      q: typeof req.query.q === 'string' ? req.query.q.trim() : '',
      offset: parseInt(req.query.offset, 10) || 0,
      limit: parseInt(req.query.limit, 10) || 50
    };
    const page = filterAndPaginate(allShaped, params);

    // Facets — computed BEFORE filter so the chip-bar can switch scope
    const facets = computeFacets(allSignals, opUseIndex, clusteredIds, entityNameById);

    // Header strip macro counts
    const ingested = bake?.signalsIngested ?? allSignals.length;
    const deduped = allSignals.length;
    const droppedDedup = Math.max(0, ingested - deduped);
    const significantTotal = allSignals.filter(s => s.isLegallySignificant).length;

    const summary = {
      ingested,
      deduped,
      droppedDedup,
      flaggedSignificant: significantTotal,
      flaggedNoise: deduped - significantTotal,
      clustered: clusteredIds.size,
      unclustered: significantTotal - Array.from(clusteredIds).filter(id => {
        const s = sigById.get(id); return s && s.isLegallySignificant;
      }).length,
      usedInOpp: opUseIndex.size,
      byDisposition: facets.byDisposition,
      bySource: facets.bySource
    };

    // Considered opportunities (the second tab)
    const consideredOpportunities = {
      surfaced: (ws.opportunities || []).map(o => shapeSurfacedOpp(o, entityById)),
      rejected: (ws.rejectedOpportunities || []).map(r => shapeRejectedOpp(r, entityById, sigById)),
      reasonTaxonomy: ws.reasonTaxonomy || {}
    };

    res.json({
      summary,
      signals: {
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        items: page.items
      },
      facets,
      consideredOpportunities,
      appliedFilters: params
    });
  });

  return router;
}
