import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, ShieldCheck, AlertTriangle, Copy, Key } from 'lucide-react';
import { opportunities as oppApi } from '../api.js';
import { friendlyError, isKeyError } from '../lib/errorMessages.js';

export default function EmailDraftModal({ workspaceId, opportunity, entity, briefing, onClose }) {
  const [draft, setDraft] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Email Draft — {entity?.legalName}</h3>
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
            <label className="caption">Subject</label>
            <input className="input" value={subject} onChange={e => setSubject(e.target.value)} />
            <label className="caption">Body</label>
            <textarea className="input" rows={14} value={body} onChange={e => setBody(e.target.value)} style={{ fontFamily: 'var(--font-body)', resize: 'vertical' }} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={() => { setSubject(draft?.subject || ''); setBody(draft?.body || ''); }}>Reset</button>
          <button className="btn btn-primary" onClick={copy}><Copy size={14} /> Copy to clipboard</button>
        </div>
      </div>
    </div>
  );
}
