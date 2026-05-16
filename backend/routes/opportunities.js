import { Router } from 'express';
import { getWorkspace, saveWorkspace, withWorkspaceLock } from '../lib/workspaceStore.js';
import { addAuditEntry } from '../lib/audit.js';
import { checkConflicts } from '../lib/conflicts.js';
import { findEntityById } from '../lib/entities.js';
import { generateBriefing, generateOutreachDraft } from '../agents/briefingGenerator.js';
import { generatePitch } from '../agents/pitchGenerator.js';
import { retrieveSimilarPitches } from '../lib/pitchRetrieval.js';
import { buildHeuristicPitch } from '../lib/pitchHeuristic.js';
import { pitchToDocxBuffer } from '../lib/pitchDocx.js';
import { requireAuth } from './auth.js';
import { isOneOf, isString, badRequest } from '../lib/validate.js';
import { llmRateLimit } from '../lib/rateLimit.js';
import { viewForRun } from './runs.js';

const OPP_STATUSES = ['new', 'contacted', 'pending', 'won', 'lost', 'dismissed', 'snoozed'];
const SANCTIONS_SOURCES = new Set(['ofac_sdn', 'eu_sanctions', 'uk_ofsi', 'sanctions_cross_ref']);
const DISMISS_REASONS = new Set(['already_in_progress', 'wrong_timing', 'wrong_service', 'relationship_sensitivity', 'incorrect_entity', 'other']);

function enrichOpp(opp, ctx) {
  const { entityMap, entityRecordMap, signalIndex, briefingIndex, now } = ctx;
  const citedSignals = (opp.basis?.signalIds || []).map(id => signalIndex[id]).filter(Boolean);
  const isSanctionsAlert = citedSignals.some(s => SANCTIONS_SOURCES.has(s.source));
  let signalAgeDays = null;
  const dates = citedSignals.map(s => s.publishedAt ? new Date(s.publishedAt).getTime() : null).filter(t => t && !isNaN(t));
  if (dates.length) {
    const mostRecent = Math.max(...dates);
    signalAgeDays = Math.max(0, Math.round((now - mostRecent) / 86400000));
  } else if (opp.generatedAt) {
    const t = new Date(opp.generatedAt).getTime();
    if (!isNaN(t)) signalAgeDays = Math.max(0, Math.round((now - t) / 86400000));
  }
  const entityRecord = entityRecordMap?.[opp.entity];
  return {
    ...opp,
    entityName: entityMap[opp.entity] || opp.entity,
    entityJurisdiction: entityRecord?.hqJurisdiction || null,
    entitySector: entityRecord?.sector || null,
    entitySize: entityRecord?.size || null,
    hasBriefing: !!briefingIndex[opp.id],
    isSanctionsAlert,
    signalAgeDays
  };
}

export function createOpportunitiesRouter(db) {
  const router = Router();

  router.get('/:id/opportunities', requireAuth, (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    const { engine, urgency, entity, status, practice, runId } = req.query;
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    // When the client passes ?runId=<historical-id>, swap the data source
    // to that archived run's snapshot. Falls back to live transparently
    // when runId is missing or unknown.
    const view = viewForRun(ws, runId);
    let opps = view.opportunities;
    if (engine) opps = opps.filter(o => o.engineSource === engine);
    if (urgency) opps = opps.filter(o => o.urgencyTier === urgency);
    if (entity) opps = opps.filter(o => o.entity === entity);
    if (status) opps = opps.filter(o => o.status === status);
    if (practice) opps = opps.filter(o => inferPracticeArea(ws.serviceTaxonomy, o.suggestedService) === practice);
    opps = opps.slice().sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, limit);
    const entityMap = {};
    const entityRecordMap = {};
    [...(ws.clients || []), ...(ws.prospects || [])].forEach(e => {
      entityMap[e.id] = e.legalName;
      entityRecordMap[e.id] = e;
    });
    const signalIndex = {};
    view.signals.forEach(s => signalIndex[s.id] = s);
    const briefingIndex = {};
    view.briefings.forEach(b => briefingIndex[b.opportunityId] = true);
    const ctx = { entityMap, entityRecordMap, signalIndex, briefingIndex, now: Date.now() };
    res.json({
      opportunities: opps.map(o => enrichOpp(o, ctx)),
      total: opps.length,
      runId: view.runId,
      isHistorical: view.isHistorical
    });
  });

  router.get('/:id/opportunities/:oid', requireAuth, (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    // Honor ?runId so the detail view can show an archived opp's full
    // record (citations + briefing) consistent with what was generated in
    // that run — not the live state which may have replaced the data.
    const view = viewForRun(ws, req.query.runId);
    const opp = view.opportunities.find(o => o.id === req.params.oid);
    if (!opp) return res.status(404).json({ error: 'opportunity not found' });
    const entity = findEntityById(ws, opp.entity);
    const briefing = view.briefings.find(b => b.opportunityId === opp.id);
    const signals = view.signals.filter(s => (opp.basis?.signalIds || []).includes(s.id));
    const entityMatters = (ws.matters || []).filter(m => m.client === opp.entity);
    const entityMap = {};
    const entityRecordMap = {};
    [...(ws.clients || []), ...(ws.prospects || [])].forEach(e => {
      entityMap[e.id] = e.legalName;
      entityRecordMap[e.id] = e;
    });
    const signalIndex = {};
    signals.forEach(s => signalIndex[s.id] = s);
    const ctx = { entityMap, entityRecordMap, signalIndex, briefingIndex: { [opp.id]: !!briefing }, now: Date.now() };
    const enriched = enrichOpp(opp, ctx);
    const conflict = checkConflicts(ws, entity?.legalName || '');
    res.json({
      opportunity: enriched,
      entity,
      briefing,
      signals,
      conflictCheck: conflict,
      entityMatters
    });
  });

  router.patch('/:id/opportunities/:oid', requireAuth, async (req, res) => {
    let out;
    try {
      out = await withWorkspaceLock(req.params.id, async () => {
        const ws = getWorkspace(db, req.params.id, req.user.id);
        if (!ws) return { status: 404, body: { error: 'not found' } };
        const opp = (ws.opportunities || []).find(o => o.id === req.params.oid);
        if (!opp) return { status: 404, body: { error: 'opportunity not found' } };
        const status = req.body?.status;
        const notes = req.body?.notes;
        const dismissReason = req.body?.dismissReason;
        if (status !== undefined && !isOneOf(status, OPP_STATUSES)) return { status: 400, body: { error: 'invalid status' } };
        if (notes !== undefined && typeof notes !== 'string') return { status: 400, body: { error: 'notes must be a string' } };
        if (dismissReason !== undefined && !DISMISS_REASONS.has(dismissReason)) return { status: 400, body: { error: 'invalid dismissReason' } };
        if (status !== undefined) {
          opp.status = status;
          opp.statusHistory = opp.statusHistory || [];
          opp.statusHistory.push({
            status,
            changedBy: req.user.email,
            changedAt: new Date().toISOString(),
            notes,
            ...(status === 'dismissed' && dismissReason ? { dismissReason } : {})
          });
        }
        if (notes !== undefined) opp.notes = notes;
        if (status === 'dismissed' && dismissReason) opp.dismissReason = dismissReason;
        addAuditEntry(ws, { type: 'user_action', actor: req.user.email, inputs: { opportunityId: opp.id }, outputs: { status, notes, dismissReason } });
        saveWorkspace(db, ws);
        return { status: 200, body: { opportunity: opp } };
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(out.status).json(out.body);
  });

  router.post('/:id/opportunities/:oid/briefing', requireAuth, llmRateLimit, async (req, res) => {
    if (!req.user.providerApiKey) {
      return res.status(400).json({
        error: 'no_llm_key_configured',
        message: 'Configure your LLM provider key in Settings → API Keys to generate briefings.'
      });
    }
    let out;
    try {
      out = await withWorkspaceLock(req.params.id, async () => {
        const ws = getWorkspace(db, req.params.id, req.user.id);
        if (!ws) return { status: 404, body: { error: 'not found' } };
        const opp = (ws.opportunities || []).find(o => o.id === req.params.oid);
        if (!opp) return { status: 404, body: { error: 'opportunity not found' } };
        const briefing = await generateBriefing({
          workspace: ws, opportunity: opp,
          apiKey: req.user.providerApiKey,
          provider: req.user.llmProvider
        });
        const existing = (ws.briefings || []).findIndex(b => b.opportunityId === opp.id);
        if (existing >= 0) ws.briefings[existing] = briefing;
        else ws.briefings = [...(ws.briefings || []), briefing];
        addAuditEntry(ws, { type: 'briefing_generation', actor: 'briefing_generator_agent', inputs: { opportunityId: opp.id }, outputs: { briefingId: briefing.id } });
        saveWorkspace(db, ws);
        return { status: 200, body: { briefing } };
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(out.status).json(out.body);
  });

  router.get('/:id/opportunities/:oid/briefing', requireAuth, (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    const briefing = (ws.briefings || []).find(b => b.opportunityId === req.params.oid);
    if (!briefing) return res.status(404).json({ error: 'briefing not found' });
    res.json({ briefing });
  });

  router.post('/:id/opportunities/:oid/draft-email', requireAuth, llmRateLimit, async (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    const opp = (ws.opportunities || []).find(o => o.id === req.params.oid);
    if (!opp) return res.status(404).json({ error: 'opportunity not found' });
    const entity = findEntityById(ws, opp.entity);
    const conflict = checkConflicts(ws, entity?.legalName || '');
    if (!req.user.providerApiKey) {
      return res.status(400).json({
        error: 'no_llm_key_configured',
        message: 'Configure your LLM provider key in Settings → API Keys to generate email drafts.',
        conflictCheck: conflict
      });
    }
    const briefing = (ws.briefings || []).find(b => b.opportunityId === opp.id);
    try {
      const draft = await generateOutreachDraft({
        workspace: ws, opportunity: opp, briefing,
        apiKey: req.user.providerApiKey,
        provider: req.user.llmProvider
      });
      try {
        await withWorkspaceLock(req.params.id, async () => {
          const ws2 = getWorkspace(db, req.params.id, req.user.id);
          if (!ws2) return;
          addAuditEntry(ws2, { type: 'user_action', actor: req.user.email, inputs: { opportunityId: opp.id }, outputs: { draftSubject: draft.subject } });
          saveWorkspace(db, ws2);
        });
      } catch (lockErr) {
        console.warn('[draft-email] audit write failed:', lockErr.message);
      }
      res.json({ draft, conflictCheck: conflict });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:id/conflicts/check', requireAuth, (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    const { entityName } = req.body || {};
    if (!isString(entityName, { max: 200 })) return badRequest(res, 'entityName required');
    res.json(checkConflicts(ws, entityName));
  });

  // ===== Pitch document generator =====
  // Three endpoints:
  //   GET  /opportunities/:oid/pitch/exemplars — return the retrieved top-K
  //        historical pitches without generating anything. The PitchModal
  //        calls this first so the partner can see what we'll learn from.
  //   POST /opportunities/:oid/pitch           — generate (LLM if BYOK,
  //        heuristic otherwise) and cache on the workspace.
  //   GET  /opportunities/:oid/pitch.docx      — stream the cached pitch
  //        as a Word document with Hartwell & Stone branded letterhead.

  router.get('/:id/opportunities/:oid/pitch/exemplars', requireAuth, (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    const opp = (ws.opportunities || []).find(o => o.id === req.params.oid);
    if (!opp) return res.status(404).json({ error: 'opportunity not found' });
    const entity = findEntityById(ws, opp.entity);
    const exemplars = retrieveSimilarPitches({
      opportunity: opp, entity, workspace: ws,
      k: Math.min(Math.max(parseInt(req.query.k, 10) || 4, 1), 8)
    });
    res.json({ exemplars });
  });

  router.post('/:id/opportunities/:oid/pitch', requireAuth, llmRateLimit, async (req, res) => {
    let out;
    try {
      out = await withWorkspaceLock(req.params.id, async () => {
        const ws = getWorkspace(db, req.params.id, req.user.id);
        if (!ws) return { status: 404, body: { error: 'not found' } };
        const opp = (ws.opportunities || []).find(o => o.id === req.params.oid);
        if (!opp) return { status: 404, body: { error: 'opportunity not found' } };
        const entity = findEntityById(ws, opp.entity);
        const briefing = (ws.briefings || []).find(b => b.opportunityId === opp.id);
        const exemplars = retrieveSimilarPitches({
          opportunity: opp, entity, workspace: ws, k: 4
        });

        // Roster the agent may cite from — capped to relevant practice
        // partners + matter credentials so the model doesn't invent.
        const practiceArea = inferPracticeArea(ws.serviceTaxonomy, opp.suggestedService);
        const partnersRoster = (ws.partners || []).filter(p =>
          (p.practiceAreas || []).includes(practiceArea)
        );
        const credentialsRoster = (ws.matters || []).filter(m =>
          (m.status === 'closed' || m.status === 'closed_won') &&
          m.practiceArea === practiceArea
        ).slice(0, 8);

        // Decide LLM vs heuristic. BYOK key → LLM; otherwise template
        // fallback so the demo always renders something even without a key.
        const wantLLM = req.body?.mode !== 'heuristic';
        const canLLM = Boolean(req.user.providerApiKey);
        let pitch;
        if (wantLLM && canLLM) {
          try {
            pitch = await generatePitch({
              workspace: ws, opportunity: opp, entity, briefing,
              exemplars, partnersRoster, credentialsRoster,
              apiKey: req.user.providerApiKey,
              provider: req.user.llmProvider
            });
          } catch (err) {
            console.warn('[pitch] LLM failed, falling back to heuristic:', err.message);
            pitch = buildHeuristicPitch({ opportunity: opp, entity, briefing, exemplars, workspace: ws });
            pitch.llmError = err.message;
          }
        } else {
          pitch = buildHeuristicPitch({ opportunity: opp, entity, briefing, exemplars, workspace: ws });
        }

        const stored = {
          id: `pitch-${opp.id}`,
          opportunityId: opp.id,
          generatedAt: new Date().toISOString(),
          generatedBy: req.user.email || 'system',
          ...pitch
        };
        const existing = (ws.pitches || []).findIndex(p =>
          p.opportunityId === opp.id && p.id?.startsWith('pitch-')
        );
        if (existing >= 0) ws.pitches[existing] = stored;
        else ws.pitches = [...(ws.pitches || []), stored];
        addAuditEntry(ws, {
          type: 'pitch_generation',
          actor: pitch.generationMode === 'llm' ? 'pitch_generator_agent' : 'pitch_heuristic',
          inputs: { opportunityId: opp.id, exemplarIds: exemplars.map(e => e.id) },
          outputs: { pitchId: stored.id, mode: pitch.generationMode }
        });
        saveWorkspace(db, ws);
        return { status: 200, body: { pitch: stored, exemplars } };
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(out.status).json(out.body);
  });

  router.get('/:id/opportunities/:oid/pitch', requireAuth, (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    const pitch = (ws.pitches || []).find(p =>
      p.opportunityId === req.params.oid && p.id?.startsWith('pitch-')
    );
    if (!pitch) return res.status(404).json({ error: 'pitch not generated yet' });
    res.json({ pitch });
  });

  router.get('/:id/opportunities/:oid/pitch.docx', requireAuth, async (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    const pitch = (ws.pitches || []).find(p =>
      p.opportunityId === req.params.oid && p.id?.startsWith('pitch-')
    );
    if (!pitch) return res.status(404).json({ error: 'pitch not generated yet' });
    try {
      const buffer = await pitchToDocxBuffer(pitch, { firmProfile: ws.firmProfile });
      const entity = findEntityById(ws, (ws.opportunities || []).find(o => o.id === req.params.oid)?.entity);
      const safeName = (entity?.legalName || 'pitch').replace(/[^a-z0-9]+/gi, '_').slice(0, 60);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="HS_${safeName}_pitch.docx"`);
      res.send(buffer);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

function inferPracticeArea(taxonomy, service) {
  for (const [paId, paBlock] of Object.entries(taxonomy?.practiceAreas || {})) {
    if ((paBlock.services || []).some(s => s.id === service)) return paId;
  }
  return null;
}
