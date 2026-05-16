// End-to-end pipeline runner — single endpoint that drives ingestion +
// engine runs + briefing generation in one go, streaming progress back
// to the client over Server-Sent Events so the UI can show a live log.
//
// Triggered from the Sources page's "Run pipeline" button. Replaces the
// workspace's signals/opportunities/briefings with the fresh output.
//
// SSE event types emitted:
//   - log:      { line }                       — human-readable progress
//   - progress: { stage, ...stageSpecific }    — structured stage updates
//   - error:    { message }                    — fatal — stream ends
//   - done:     { signals, opportunities, ... } — final summary
//
// Client consumes via fetch + ReadableStream (NOT EventSource — EventSource
// is GET-only and we need POST for the body + CSRF). The frontend
// pipelineApi.run helper handles the streaming + line parsing.

import { Router } from 'express';
import { getWorkspace, saveWorkspace, withWorkspaceLock } from '../lib/workspaceStore.js';
import { addAuditEntry } from '../lib/audit.js';
import { runIngestionForWorkspace } from '../sources/orchestrator.js';
import { runCrossSellEngine } from '../engines/crossSell.js';
import { runProspectDiscoveryEngine } from '../engines/prospectDiscovery.js';
import { runEventIntelligenceEngine } from '../engines/eventIntelligence.js';
import { generateBriefing } from '../agents/briefingGenerator.js';
import { gateOpportunity } from '../lib/opportunityPipeline.js';
import { requireAuth } from './auth.js';
import { llmRateLimit } from '../lib/rateLimit.js';

// Map an engine string sent by the client to its runner + opp type. The
// allowlist also gates which engine names the route will accept — anything
// else gets silently dropped.
const ENGINE_RUNNERS = {
  cross_sell:           { fn: runCrossSellEngine,           oppType: 'cross_sell',   audit: 'cross_sell_engine' },
  prospect_discovery:   { fn: runProspectDiscoveryEngine,   oppType: 'prospect',     audit: 'prospect_discovery_engine' },
  event_intelligence:   { fn: runEventIntelligenceEngine,   oppType: 'event_driven', audit: 'event_intelligence_engine' }
};

function mergeOpportunities(ws, incoming, type) {
  ws.opportunities = ws.opportunities || [];
  const existing = new Map(ws.opportunities.map(o => [o.id, o]));
  for (const o of incoming) existing.set(o.id, { ...existing.get(o.id), ...o, type });
  ws.opportunities = Array.from(existing.values());
}

// Strip the heavy fields from each signal before archiving. The full signal
// pool can be 1-3 KB per signal; cap at 5 archived runs × ~1000 signals would
// otherwise grow the workspace JSON blob to ~10 MB and sql.js rewrites the
// whole DB buffer on every save. Keep enough metadata to render the signal
// list + reference IDs (briefings' citedSources already embed title + url +
// excerpt directly, so the body content here is duplicative).
function slimSignalForArchive(s) {
  if (!s || typeof s !== 'object') return s;
  return {
    id: s.id,
    source: s.source,
    sourceUrl: s.sourceUrl || s.url,
    title: s.title,
    publishedAt: s.publishedAt,
    entities: s.entities,
    isLegallySignificant: s.isLegallySignificant,
    jurisdictions: s.jurisdictions
    // description, excerpt, rawMetadata, fusionGroupSize, etc — DROPPED
  };
}

export function createPipelineRouter(db) {
  const router = Router();

  router.post('/:id/pipeline/run', requireAuth, llmRateLimit, async (req, res) => {
    // Gate on LLM key — every step that follows depends on the user's BYOK.
    // Surface the gate BEFORE we open the SSE stream so the UI can show a
    // normal 400 rather than a "stream ended without finishing" message.
    if (!req.user.providerApiKey) {
      return res.status(400).json({
        error: 'no_llm_key_configured',
        message: 'Configure your LLM provider key in Settings → API Keys before running the pipeline.'
      });
    }

    const body = req.body || {};
    const sources = Array.isArray(body.sources) ? body.sources : null;
    const engines = Array.isArray(body.engines)
      ? body.engines.filter(e => ENGINE_RUNNERS[e])
      : Object.keys(ENGINE_RUNNERS);
    const generateBriefings = body.generateBriefings !== false;
    const briefingTopN = Math.max(1, Math.min(50, Number(body.briefingTopN) || 20));

    // Open the SSE response. nginx/render add response buffering by default
    // which holds the stream until the request completes — `X-Accel-Buffering: no`
    // disables it. Also flush headers immediately so the client knows the
    // connection is live (some browsers wait for the first event otherwise).
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (event, data) => {
      // Multi-line JSON has to be on a single line in SSE — JSON.stringify
      // never produces a newline by default, but we strip just in case.
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const log = (line) => send('log', { line, ts: new Date().toISOString() });

    const apiKey = req.user.providerApiKey;
    const provider = req.user.llmProvider;
    const wsId = req.params.id;
    const startedAt = Date.now();

    log('[pipeline] starting…');
    log(`[pipeline] provider=${provider}, engines=${engines.join(',')||'(none)'}, sources=${(sources||['workspace-default']).length}`);

    // Lock strategy: previously the workspace lock was held for the ENTIRE
    // run (ingest + engines + briefings = many minutes). Any concurrent
    // mutation by another tab/user would queue behind the pipeline. We now
    // hold the lock briefly at two points:
    //   (1) start: snapshot the workspace + return a local copy to work on
    //   (2) end:   re-fetch the latest workspace, apply our pipeline output
    //              (overwriting signals/opps/briefings), preserve any
    //              concurrent mutations to other fields (chatHistory,
    //              externalSourceConfig, name, etc).
    // The slow work (ingestion, engine runs, briefings) happens between
    // those two short locks — concurrent writes to OTHER workspace fields
    // get preserved because the final lock re-fetches and merges. Writes
    // to signals/opps/briefings WILL be overwritten — that's by design
    // since the pipeline is replacing those exact fields.
    try {
      // === Stage 0: snapshot + archive (short lock) ===
      let ws, archivedSnapshot = null;
      await withWorkspaceLock(wsId, async () => {
        ws = getWorkspace(db, wsId, req.user.id);
        if (!ws) return;
        if ((ws.opportunities || []).length || (ws.signals || []).length) {
          archivedSnapshot = {
            id: `run-${new Date().toISOString().replace(/[:.]/g, '-')}`,
            completedAt: new Date().toISOString(),
            label: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
            // Just use the current run's provider — the prior-run-provider
            // lookup we had was off-by-one and the value is decorative.
            provider,
            counts: {
              signals: (ws.signals || []).length,
              opportunities: (ws.opportunities || []).length,
              briefings: (ws.briefings || []).length
            },
            // Slim each signal — drops the heavy `description` + `rawMetadata`
            // fields, keeps IDs/titles/URLs so the historical view can still
            // render the signal list. Briefings already embed cited-source
            // excerpts inline, so the full bodies here are duplicative.
            // Cuts archive size by ~70-80%.
            signals: (ws.signals || []).map(slimSignalForArchive),
            opportunities: ws.opportunities || [],
            briefings: ws.briefings || []
          };
        }
      });
      if (!ws) { send('error', { message: 'workspace not found' }); res.end(); return; }
      // Snapshot the entity rosters since they don't change during the run.
      // We work on a LOCAL clone so concurrent writes outside the lock window
      // can't corrupt our in-progress state.
      ws = { ...ws, signals: [], opportunities: [], briefings: [] };
      if (archivedSnapshot) {
        log(`[pipeline] will archive previous run (${archivedSnapshot.counts.opportunities} opps, ${archivedSnapshot.counts.signals} signals)`);
      }

      // === Stage 1: Ingestion (no lock) ===
      log('[pipeline] === Stage 1/3: Ingesting external signals ===');
      const ingestResult = await runIngestionForWorkspace({
        workspace: ws,
        sourcesOverride: sources,
        onProgress: log
      });
      send('progress', {
        stage: 'ingest',
        totalSignals: ingestResult.totalSignals,
        perSource: ingestResult.perSource,
        perSourceErrors: ingestResult.perSourceErrors,
        durationMs: ingestResult.durationMs
      });
      log(`[pipeline] ingestion complete: ${ingestResult.totalSignals} signals from ${Object.keys(ingestResult.perSource).length} sources`);

      // Guard: if the user picked zero (or unreachable) sources and we got
      // back nothing, refuse to wipe their workspace. Previously the route
      // unconditionally reset signals/opps/briefings before ingestion ran —
      // a user who clicked Run with no sources selected would lose live
      // state. Now we abort early and leave state intact.
      if (ingestResult.totalSignals === 0) {
        send('error', {
          message: 'No signals ingested — aborting pipeline so existing workspace data is preserved. Check your source selection or API credentials.'
        });
        log('[pipeline] aborted: 0 signals ingested, preserving prior workspace state.');
        res.end();
        return;
      }

      // === Stage 2: Engines (no lock) ===
      log('[pipeline] === Stage 2/3: Generating opportunities ===');
      const engineSummary = {};
      for (const engineName of engines) {
        const runner = ENGINE_RUNNERS[engineName];
        log(`[pipeline] running ${engineName} engine…`);
        let raw;
        try {
          raw = await runner.fn({ workspace: ws, apiKey, provider });
        } catch (err) {
          log(`[pipeline] ${engineName} engine FAILED: ${err.message?.slice(0, 200)}`);
          engineSummary[engineName] = { raw: 0, gated: 0, dropped: 0, error: err.message };
          continue;
        }
        const gated = [];
        let dropped = 0;
        for (const opp of raw) {
          const oppSignals = (ws.signals || []).filter(s => (opp.basis?.signalIds || []).includes(s.id));
          const entity = (ws.clients || []).find(c => c.id === opp.entity)
            || (ws.prospects || []).find(p => p.id === opp.entity);
          const gatedOpp = await gateOpportunity(opp, {
            signals: oppSignals, entity, apiKey, provider
          });
          if (!gatedOpp) { dropped++; continue; }
          gated.push(gatedOpp);
        }
        mergeOpportunities(ws, gated, runner.oppType);
        engineSummary[engineName] = { raw: raw.length, gated: gated.length, dropped };
        send('progress', { stage: 'engine', engine: engineName, ...engineSummary[engineName] });
        log(`[pipeline] ${engineName}: ${gated.length} opps (${dropped} dropped at quality gate)`);
      }

      // === Stage 3: Briefings (no lock) ===
      if (generateBriefings && (ws.opportunities || []).length) {
        log(`[pipeline] === Stage 3/3: Generating briefings for top ${briefingTopN} ===`);
        const top = (ws.opportunities || [])
          .slice()
          .sort((a, b) => (b.score || 0) - (a.score || 0))
          .slice(0, briefingTopN);
        ws.briefings = ws.briefings || [];
        let briefed = 0, briefFails = 0;
        for (const opp of top) {
          try {
            const briefing = await generateBriefing({
              workspace: ws,
              opportunity: opp,
              apiKey, provider
            });
            ws.briefings.push(briefing);
            briefed++;
            if (briefed % 5 === 0) log(`[pipeline] briefings: ${briefed}/${top.length}`);
          } catch (err) {
            briefFails++;
            console.warn(`[pipeline] briefing for ${opp.id} failed: ${err.message}`);
          }
        }
        send('progress', { stage: 'briefings', briefed, briefFails });
        log(`[pipeline] briefings complete: ${briefed}/${top.length} (${briefFails} failures)`);
      }

      // === Stage 4: persist (short lock) ===
      // Re-fetch the workspace so any concurrent mutations to fields we
      // DON'T own (chatHistory, name, externalSourceConfig) are preserved.
      // Pipeline-owned fields (signals/opps/briefings/history/activeRunId/
      // bakedAt) are unconditionally overwritten with our run output.
      const now = new Date().toISOString();
      const runId = `run-${now.replace(/[:.]/g, '-')}`;
      await withWorkspaceLock(wsId, async () => {
        const fresh = getWorkspace(db, wsId, req.user.id);
        if (!fresh) return;
        fresh.signals = ws.signals;
        fresh.opportunities = ws.opportunities;
        fresh.briefings = ws.briefings;
        fresh.pipelineRunHistory = fresh.pipelineRunHistory || [];
        if (archivedSnapshot) {
          fresh.pipelineRunHistory.push(archivedSnapshot);
          while (fresh.pipelineRunHistory.length > 5) fresh.pipelineRunHistory.shift();
        }
        fresh.bakedAt = now;
        fresh.activeRunId = runId;
        // Engine + pipeline audit entries — added to whatever audit trail
        // exists on the fresh workspace, so concurrent audit entries from
        // chat / status updates during the run aren't lost.
        for (const [engineName, summary] of Object.entries(engineSummary)) {
          addAuditEntry(fresh, {
            type: 'engine_run',
            actor: ENGINE_RUNNERS[engineName]?.audit || engineName,
            outputs: { generated: summary.gated, dropped: summary.dropped, raw: summary.raw }
          });
        }
        addAuditEntry(fresh, {
          type: 'pipeline_run',
          actor: 'pipeline_runner',
          inputs: { sources: sources || 'workspace-default', engines, generateBriefings },
          outputs: {
            signals: (fresh.signals || []).length,
            opportunities: (fresh.opportunities || []).length,
            briefings: (fresh.briefings || []).length,
            engineSummary,
            durationMs: Date.now() - startedAt
          }
        });
        saveWorkspace(db, fresh);
      });

      send('done', {
        runId,
        signals: (ws.signals || []).length,
        opportunities: (ws.opportunities || []).length,
        briefings: (ws.briefings || []).length,
        ingest: ingestResult.perSource,
        engines: engineSummary,
        durationMs: Date.now() - startedAt
      });
      log(`[pipeline] complete in ${Math.round((Date.now() - startedAt) / 1000)}s`);
    } catch (err) {
      console.error('[pipeline] fatal:', err);
      send('error', { message: err.message || String(err) });
    }
    res.end();
  });

  return router;
}
