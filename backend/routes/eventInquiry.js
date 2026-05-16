// Event Inquiry routes — the workspace-scoped "tell me about this event
// and find opportunities" conversational surface. Two endpoints:
//
//   POST /workspaces/:id/event-inquiry/chat
//     Body: { message, history }
//     Returns the agent's reply + (when identify_opportunities ran) a list
//     of PROPOSED opportunities. Nothing is persisted — the partner reviews
//     and clicks Save on each one they want.
//
//   POST /workspaces/:id/event-inquiry/save-opp
//     Body: { proposal }   (one of the proposed opps from the chat reply)
//     Persists the opportunity to workspace.opportunities AFTER routing it
//     through the same sanctions + critic gate every other persistable opp
//     goes through. Returns the persisted opp (or the gate's drop verdict).

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getWorkspace, saveWorkspace, withWorkspaceLock } from '../lib/workspaceStore.js';
import { addAuditEntry } from '../lib/audit.js';
import { runEventInquiryAgent } from '../agents/eventInquiryAgent.js';
import { gateOpportunity } from '../lib/opportunityPipeline.js';
import { opportunityId, deterministicId } from '../lib/ids.js';
import { requireAuth } from './auth.js';
import { llmRateLimit } from '../lib/rateLimit.js';
import { isString, badRequest } from '../lib/validate.js';

function slugify(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

// Map a service id (from the firm's taxonomy) to one or more triggers from
// the workspace-wide trigger taxonomy. Used by the event-inquiry save flow
// so saved opps carry meaningful trigger labels (which power the OppBoard
// filter chips). Previously every event-inquiry opp got the hardcoded
// triggers ['litigation', 'regulatory'] regardless of the inquiry topic.
function triggersForService(service) {
  if (!service) return ['regulatory'];
  const s = service.toLowerCase();
  if (s.includes('sanctions') || s.includes('ofac') || s.includes('ofsi') || s.includes('export_control')) return ['sanctions-trade'];
  if (s.includes('force_majeure')) return ['force-majeure'];
  if (s.includes('merger_control') || s.includes('competition') || s.includes('antitrust')) return ['competition-antitrust'];
  if (s.includes('cybersecurity') || s.includes('data_protection')) return ['cyber-security'];
  if (s.includes('ma') || s.includes('cross_border') || s.includes('takeover') || s.includes('joint_venture')) return ['m-and-a'];
  if (s.includes('litigation') || s.includes('class_action') || s.includes('disputes') || s.includes('regulatory_defense')) return ['litigation'];
  if (s.includes('financial_services') || s.includes('esg') || s.includes('ai_regulation') || s.includes('fda') || s.includes('regulation')) return ['regulatory'];
  // Default for unmapped services — regulatory is the broadest category in
  // the existing taxonomy and a safe fallback.
  return ['regulatory'];
}

export function createEventInquiryRouter(db) {
  const router = Router();

  router.post('/:id/event-inquiry/chat', requireAuth, llmRateLimit, async (req, res) => {
    const message = req.body?.message;
    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-10) : [];
    if (!isString(message, { max: 4000 })) return badRequest(res, 'message required (1-4000 chars)');
    if (!req.user.providerApiKey) {
      return res.status(400).json({
        error: 'no_llm_key_configured',
        message: 'Configure your LLM provider key in Settings → API Keys to use event inquiry.'
      });
    }

    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });

    try {
      const result = await runEventInquiryAgent({
        workspace: ws,
        message,
        history,
        apiKey: req.user.providerApiKey,
        provider: req.user.llmProvider
      });
      // Best-effort audit log — never block the response on this.
      try {
        await withWorkspaceLock(req.params.id, async () => {
          const ws2 = getWorkspace(db, req.params.id, req.user.id);
          if (!ws2) return;
          addAuditEntry(ws2, {
            type: 'user_action',
            actor: 'event_inquiry_agent',
            inputs: { message: message.slice(0, 200) },
            outputs: {
              reply: result.content?.slice(0, 200),
              toolsUsed: (result.toolsUsed || []).map(t => t.tool),
              proposedOppCount: result.generatedOpps?.opportunities?.length || 0
            }
          });
          saveWorkspace(db, ws2);
        });
      } catch (auditErr) {
        console.warn('[event-inquiry] audit write failed:', auditErr.message);
      }
      res.json({
        message: {
          role: 'assistant',
          content: result.content,
          timestamp: new Date().toISOString()
        },
        toolsUsed: result.toolsUsed || [],
        generatedOpps: result.generatedOpps || null,
        // Eventually-useful provenance — the inquiry message is what
        // distinguishes this from screening on a pre-extracted cluster.
        inquiryMessage: message.slice(0, 500)
      });
    } catch (err) {
      console.error('[event-inquiry:chat] FAIL:', err);
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  router.post('/:id/event-inquiry/save-opp', requireAuth, async (req, res) => {
    const proposal = req.body?.proposal;
    const sourceMessage = req.body?.sourceMessage || '';
    if (!proposal || typeof proposal !== 'object') return badRequest(res, 'proposal required');
    // The chat reply gives us a flat shape:
    //   { entity, isNewProspect, service, urgency, confidence, score, summary, reasoning }
    if (!isString(proposal.service, { max: 64 })) return badRequest(res, 'proposal.service required');
    if (!isString(proposal.entity, { max: 200 })) return badRequest(res, 'proposal.entity required');

    let out;
    try {
      out = await withWorkspaceLock(req.params.id, async () => {
        const ws = getWorkspace(db, req.params.id, req.user.id);
        if (!ws) return { status: 404, body: { error: 'not found' } };

        // Resolve the entity. The proposal carries the entity NAME (not id),
        // so we look it up by name match across clients+prospects; if no
        // match AND isNewProspect=true, create a new prospect record.
        const haystack = [...(ws.clients || []), ...(ws.prospects || [])];
        let entityObj = haystack.find(e =>
          e.legalName?.toLowerCase() === proposal.entity.toLowerCase()
          || (Array.isArray(e.knownAliases) && e.knownAliases.some(a => a?.toLowerCase() === proposal.entity.toLowerCase()))
        );
        let isNew = false;
        if (!entityObj) {
          if (!proposal.isNewProspect) {
            return { status: 400, body: { error: 'entity_not_found', message: `No client or prospect named "${proposal.entity}" — mark isNewProspect=true to create.` } };
          }
          const newId = `pr-inquiry-${slugify(proposal.entity)}`;
          // Race-safety — if a duplicate inquiry created the same prospect,
          // reuse it. Stable id by name means the same name → same id.
          entityObj = (ws.prospects || []).find(p => p.id === newId);
          if (!entityObj) {
            entityObj = {
              id: newId,
              legalName: proposal.entity,
              knownAliases: [],
              sector: proposal.sector || null,
              hqJurisdiction: proposal.hqJurisdiction || null,
              countriesOfOperation: [],
              size: 'unknown',
              externalIdentifiers: {},
              decisionMakers: [],
              discoverySource: 'event_inquiry',
              discoveryRationale: sourceMessage.slice(0, 500),
              fitScore: proposal.confidence ?? 0.5
            };
            ws.prospects = ws.prospects || [];
            ws.prospects.push(entityObj);
            isNew = true;
          }
        }

        // Build a minimal opp record. Event-inquiry opps don't have backing
        // signal IDs in our pool (the agent fetched external context for
        // them via Tavily, but those URLs aren't in workspace.signals).
        // We store a synthetic "inquiry" provenance instead.
        const inquiryRef = deterministicId('inq', proposal.entity, proposal.service, sourceMessage.slice(0, 200));
        const id = opportunityId('event_inquiry', entityObj.id, proposal.service, [inquiryRef]);
        const now = new Date().toISOString();
        const opp = {
          id,
          type: 'event_driven',
          engineSource: 'event_inquiry',
          entity: entityObj.id,
          entityType: (ws.prospects || []).some(p => p.id === entityObj.id) ? 'prospect' : 'client',
          suggestedService: proposal.service,
          urgencyTier: proposal.urgency || 'this_week',
          confidence: typeof proposal.confidence === 'number' ? proposal.confidence : 0.6,
          score: typeof proposal.score === 'number' ? proposal.score : 70,
          estimatedRevenue: null,
          competitiveContext: 'open',
          severity: 'p2',
          // Trigger derived from the service rather than hardcoded — keeps
          // the OppBoard's risk-domain filter chips meaningful when the
          // user surfaces a mix of sanctions / M&A / litigation / etc.
          // opps via event inquiries.
          triggers: triggersForService(proposal.service),
          generatedAt: now,
          status: 'new',
          statusHistory: [{ status: 'new', changedBy: 'event_inquiry', changedAt: now }],
          notes: 'Surfaced via partner Event Inquiry. Verify externally before outreach.',
          basis: {
            summary: proposal.summary || `${entityObj.legalName} — ${proposal.service}`,
            signalIds: [],
            matterReferences: [],
            reasoning: proposal.reasoning || sourceMessage,
            inquiryMessage: sourceMessage.slice(0, 500),
            inquiryRef
          }
        };

        // Quality gate. Event-inquiry opps have no backing signals in our
        // pool (the agent fetched external Tavily context but those URLs
        // weren't ingested), so the critic's "zero supporting signals"
        // BLOCKER rule would unconditionally drop every save. Skip the
        // critic here — the agent's `marketScreeningAgent` has already
        // applied the same judgement when proposing the opp. Sanctions
        // pre-filter is a no-op anyway (no signals).
        const gated = await gateOpportunity(opp, {
          signals: [],
          entity: entityObj,
          skipCritic: true
        });
        if (!gated) {
          return { status: 200, body: { dropped: true, reason: 'quality_gate_blocker' } };
        }

        ws.opportunities = ws.opportunities || [];
        // Dedupe by id — re-saving an identical proposal updates rather
        // than appends, so partners can iterate on the same inquiry.
        const existingIdx = ws.opportunities.findIndex(o => o.id === gated.id);
        if (existingIdx >= 0) ws.opportunities[existingIdx] = gated;
        else ws.opportunities.push(gated);

        addAuditEntry(ws, {
          type: 'user_action',
          actor: req.user.email || 'event_inquiry',
          inputs: { sourceMessage: sourceMessage.slice(0, 200), entity: entityObj.legalName },
          outputs: { opportunityId: gated.id, isNewProspect: isNew, service: proposal.service }
        });
        saveWorkspace(db, ws);
        return { status: 200, body: { opportunity: gated, isNewProspect: isNew } };
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(out.status).json(out.body);
  });

  return router;
}
