import { Router } from 'express';
import { getWorkspace, saveWorkspace, withWorkspaceLock } from '../lib/workspaceStore.js';
import { addAuditEntry } from '../lib/audit.js';
import { runChatAgent, runOpportunityChatAgent } from '../agents/chatAgent.js';
import { findEntityById } from '../lib/entities.js';
import { requireAuth } from './auth.js';
import { isString, badRequest } from '../lib/validate.js';
import { llmRateLimit } from '../lib/rateLimit.js';

// Returns null when the user has a configured BYOK key; otherwise a 400 with
// a helpful pointer to the Settings page. With the Databricks/ambient
// fallback removed every LLM call is strict BYOK.
function requireLLMKey(req, res) {
  if (req.user.providerApiKey) return null;
  return res.status(400).json({
    error: 'no_llm_key_configured',
    message: 'Configure your LLM provider key in Settings → API Keys before using AI features.'
  });
}

export function createChatRouter(db) {
  const router = Router();

  router.get('/:id/chat', requireAuth, (req, res) => {
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    res.json({ chatHistory: ws.chatHistory || [] });
  });

  router.post('/:id/chat', requireAuth, llmRateLimit, async (req, res) => {
    const message = req.body?.message;
    if (!isString(message, { max: 4000 })) return badRequest(res, 'message required (1-4000 chars)');
    if (requireLLMKey(req, res)) return;

    // Read workspace + run agent OUTSIDE the lock to avoid blocking other operations
    // during the (slow) LLM call. Persist user + assistant messages inside the lock.
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    let out;
    try {
      const response = await runChatAgent({
        workspace: ws,
        message,
        apiKey: req.user.providerApiKey,
        provider: req.user.llmProvider
      });
      out = await withWorkspaceLock(req.params.id, async () => {
        const ws2 = getWorkspace(db, req.params.id, req.user.id);
        if (!ws2) return { status: 404, body: { error: 'not found' } };
        const ts = new Date().toISOString();
        const userMsg = { id: `m-${Date.now()}-u`, role: 'user', content: message, timestamp: ts, workspaceId: ws2.id };
        const assistantMsg = {
          id: `m-${Date.now()}-a`,
          role: 'assistant',
          content: response.content,
          citations: response.citations || [],
          invokedActions: response.invokedActions || [],
          timestamp: new Date().toISOString(),
          workspaceId: ws2.id
        };
        ws2.chatHistory = [...(ws2.chatHistory || []), userMsg, assistantMsg];
        addAuditEntry(ws2, { type: 'user_action', actor: 'chat_agent', inputs: { message: message.slice(0, 200) }, outputs: { reply: response.content?.slice(0, 200) } });
        saveWorkspace(db, ws2);
        return { status: 200, body: { message: assistantMsg } };
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(out.status).json(out.body);
  });

  // Per-opportunity chat — the agent gets the full opp context (entity,
  // signals, briefing, matters) and answers questions about THIS opportunity.
  // History is sent by the client; we don't persist it to the workspace blob
  // (each opportunity chat is a transient conversation).
  router.post('/:id/opportunities/:oid/chat', requireAuth, llmRateLimit, async (req, res) => {
    const message = req.body?.message;
    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-10) : [];
    if (!isString(message, { max: 4000 })) return badRequest(res, 'message required (1-4000 chars)');
    if (requireLLMKey(req, res)) return;
    const ws = getWorkspace(db, req.params.id, req.user.id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    const opportunity = (ws.opportunities || []).find(o => o.id === req.params.oid);
    if (!opportunity) return res.status(404).json({ error: 'opportunity not found' });
    const entity = findEntityById(ws, opportunity.entity);
    const briefing = (ws.briefings || []).find(b => b.opportunityId === opportunity.id);
    const signals = (ws.signals || []).filter(s => (opportunity.basis?.signalIds || []).includes(s.id));
    const entityMatters = (ws.matters || []).filter(m => m.client === opportunity.entity);
    try {
      const response = await runOpportunityChatAgent({
        workspace: ws,
        opportunity,
        entity,
        signals,
        briefing,
        entityMatters,
        message,
        history,
        apiKey: req.user.providerApiKey,
        provider: req.user.llmProvider
      });
      // Audit-log but don't persist the conversation to chat history (kept
      // workspace-scoped only). Per-opp chat is transient by design.
      await withWorkspaceLock(req.params.id, async () => {
        const ws2 = getWorkspace(db, req.params.id, req.user.id);
        if (!ws2) return;
        addAuditEntry(ws2, {
          type: 'user_action',
          actor: 'opp_chat_agent',
          inputs: { opportunityId: opportunity.id, message: message.slice(0, 200) },
          outputs: { reply: response.content?.slice(0, 200) }
        });
        saveWorkspace(db, ws2);
      });
      res.json({
        message: {
          role: 'assistant',
          content: response.content,
          citations: response.citations || [],
          timestamp: new Date().toISOString()
        }
      });
    } catch (err) {
      console.error('[opp-chat] FAIL:', err);
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  router.delete('/:id/chat', requireAuth, async (req, res) => {
    let out;
    try {
      out = await withWorkspaceLock(req.params.id, async () => {
        const ws = getWorkspace(db, req.params.id, req.user.id);
        if (!ws) return { status: 404, body: { error: 'not found' } };
        ws.chatHistory = [];
        saveWorkspace(db, ws);
        return { status: 204 };
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
    if (out.status === 204) res.status(204).end();
    else res.status(out.status).json(out.body);
  });

  return router;
}
