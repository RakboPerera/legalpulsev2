import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, ShieldCheck, AlertTriangle, Copy, Key, Send, Check } from 'lucide-react';
import { opportunities as oppApi } from '../api.js';
import { friendlyError, isKeyError } from '../lib/errorMessages.js';

export default function EmailDraftModal({ workspaceId, opportunity, entity, briefing, onClose }) {
  const [draft, setDraft] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  // Phase 2 — recipient + send state. Pre-populated with the first
  // decision-maker email from the entity record if available; otherwise
  // the partner types it in.
  //
  // Array.isArray guard: some entity records carry decisionMakers as an
  // object (legacy shape) or null instead of an array. Without the guard
  // .map would throw and the modal would fail to mount.
  const initialTo = (Array.isArray(entity?.decisionMakers) ? entity.decisionMakers : [])
    .map(d => d?.email)
    .find(e => typeof e === 'string' && e.includes('@')) || '';
  const [recipient, setRecipient] = useState(initialTo);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [sendOk, setSendOk] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await oppApi.draftEmail(workspaceId, opportunity.id);
        if (cancelled) return;
        setDraft(res.draft);
        setConflict(res.conflictCheck);
        setSubject(res.draft?.subject || '');
        setBody(res.draft?.body || '');
      } catch (err) {
        if (cancelled) return;
        // No fallback prose — a templated AI-flavoured email landing in a
        // partner-facing modal does more harm than good. Show the error
        // clearly and let the partner write their own opener, or add a key.
        setDraft(null);
        setSubject('');
        setBody('');
        setError({ text: friendlyError(err), needsKey: isKeyError(err) });
        // Still run the conflicts check — that's useful even without a draft.
        try {
          const r = await oppApi.conflictsCheck(workspaceId, entity?.legalName || '');
          if (!cancelled) setConflict(r);
        } catch {}
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceId, opportunity, entity, briefing]);

  const copy = () => {
    navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`).catch(() => {});
  };

  // Send the current subject/body via the backend SendGrid integration.
  // The backend handles SendGrid auth + sender verification + audit-trail
  // logging; the modal just surfaces success/failure.
  const send = async () => {
    setSendError(null);
    setSendOk(null);
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      setSendError({ text: 'Enter a valid recipient email.' });
      return;
    }
    setSendBusy(true);
    try {
      const res = await oppApi.sendEmail(workspaceId, opportunity.id, {
        to: recipient,
        subject,
        body
      });
      setSendOk({ messageId: res.messageId });
    } catch (err) {
      const code = err.response?.data?.error;
      const details = err.response?.data?.message || err.response?.data?.details;
      setSendError({
        text: details || friendlyError(err),
        needsEmailKey: code === 'no_email_key_configured' || code === 'no_email_from_configured'
      });
    } finally {
      setSendBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Pulse Briefing — Email Draft for {entity?.legalName}</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div className="modal-body">
          {conflict?.conflicted ? (
            <div className="banner-warn" style={{ marginBottom: 16 }}>
              <AlertTriangle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Conflict detected: {conflict.hits.map(h => h.entityName).join(', ')}. Do NOT send without partner review.
            </div>
          ) : (
            <div className="banner-pass" style={{ marginBottom: 16 }}>
              <ShieldCheck size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Conflicts check passed.
            </div>
          )}

          {error && (
            <div className="banner-warn" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <AlertTriangle size={14} />
              <div style={{ flex: 1 }}>
                {error.needsKey
                  ? 'Add your AI provider key to generate draft emails from briefings.'
                  : <>Couldn’t generate a draft: {error.text}</>}
              </div>
              {error.needsKey && (
                <Link to="/settings" className="btn btn-secondary" style={{ padding: '6px 12px' }}>
                  <Key size={12} /> Open Settings
                </Link>
              )}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label className="caption">To</label>
            <input
              className="input"
              type="email"
              value={recipient}
              placeholder="recipient@example.com"
              onChange={e => setRecipient(e.target.value)}
            />
            <label className="caption">Subject</label>
            <input className="input" value={subject} onChange={e => setSubject(e.target.value)} />
            <label className="caption">Body</label>
            <textarea className="input" rows={14} value={body} onChange={e => setBody(e.target.value)} style={{ fontFamily: 'var(--font-body)', resize: 'vertical' }} />
          </div>

          {sendError && (
            <div className="banner-warn" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <AlertTriangle size={14} />
              <div style={{ flex: 1 }}>
                {sendError.needsEmailKey
                  ? 'Add your SendGrid API key + verified sender address in Settings → Email to enable sending.'
                  : <>Couldn't send: {sendError.text}</>}
              </div>
              {sendError.needsEmailKey && (
                <Link to="/settings" className="btn btn-secondary" style={{ padding: '6px 12px' }}>
                  <Key size={12} /> Open Settings
                </Link>
              )}
            </div>
          )}

          {sendOk && (
            <div className="banner-pass" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <Check size={14} />
              <div style={{ flex: 1 }}>
                Email queued via SendGrid{sendOk.messageId ? ` (id: ${String(sendOk.messageId).slice(0, 20)}…)` : ''}. The lifecycle row will appear in the audit trail on next refresh.
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={() => { setSubject(draft?.subject || ''); setBody(draft?.body || ''); }}>Reset</button>
          <button className="btn btn-secondary" onClick={copy}><Copy size={14} /> Copy</button>
          <button
            className="btn btn-primary"
            onClick={send}
            disabled={sendBusy || conflict?.conflicted || !subject || !body}
            title={conflict?.conflicted ? 'Cannot send while a conflict is flagged. Resolve the conflict first.' : ''}
          >
            <Send size={14} /> {sendBusy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
