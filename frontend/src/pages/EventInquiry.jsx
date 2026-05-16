import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, Sparkles, MessageCircle, Loader2, Plus, Check, ExternalLink, AlertCircle, Wrench, ArrowRight } from 'lucide-react';
import { useWorkspace } from '../components/WorkspaceContext.jsx';
import { eventInquiry as inquiryApi } from '../api.js';
import AcronymText from '../components/AcronymText.jsx';
import { friendlyError, isKeyError } from '../lib/errorMessages.js';
import { useTitle } from '../lib/useTitle.js';

const STARTER_PROMPTS = [
  'Russia just sanctioned 14 European banks — who on our book is exposed?',
  'FDA issued a Form 483 to Pfizer\'s Sligo plant — what is the play?',
  'CMA opened a market investigation into UK cloud services — which of our clients are affected?',
  'Strait of Hormuz tanker disruption continues — what mandates does this create across our energy book?'
];

/**
 * Free-form Event Inquiry chat. Reuses the per-event tool-use agent
 * (tavily_search + identify_opportunities) but anchors on a partner's
 * typed question rather than a pre-extracted event cluster.
 *
 * Each agent reply may carry a `generatedOpps` payload — proposed
 * opportunities the partner reviews. "Save" persists one through the
 * server's quality gate; "Skip" just drops it from the local view.
 */
export default function EventInquiry() {
  useTitle('Event inquiry');
  const { currentId } = useWorkspace();
  const [messages, setMessages] = useState([]); // {role, content, timestamp, generatedOpps?, savedOppIds?}
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Track which proposed opps have been saved + the resulting opportunity ID
  // so the UI can offer a "View opportunity →" breadcrumb back to the
  // persisted record. Keyed by `${messageIndex}:${proposalIndex}` — stable
  // across re-renders. Map (not Set) because we need to retrieve the opp id.
  const [savedOpps, setSavedOpps] = useState({});  // key → { oppId, isNewProspect }
  const [saving, setSaving] = useState({});
  const streamRef = useRef(null);

  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [messages, busy]);

  const send = async (textOverride) => {
    const message = (textOverride ?? input).trim();
    if (!message || busy) return;
    setError(null);
    setBusy(true);
    const userMsg = { role: 'user', content: message, timestamp: new Date().toISOString() };
    // History sent to the server is the prior turns (not the brand-new one).
    const history = messages.map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    try {
      const r = await inquiryApi.chat(currentId, message, history);
      setMessages(prev => [...prev, {
        ...r.message,
        generatedOpps: r.generatedOpps,
        inquiryMessage: r.inquiryMessage,
        toolsUsed: r.toolsUsed
      }]);
    } catch (err) {
      setError({ kind: isKeyError(err) ? 'no_key' : 'general', message: friendlyError(err) });
      setMessages(prev => prev.slice(0, -1));
      setInput(message);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = e => { e.preventDefault(); send(); };

  const saveProposal = async (messageIndex, proposalIndex) => {
    const key = `${messageIndex}:${proposalIndex}`;
    if (savedOpps[key] || saving[key]) return;
    setSaving(prev => ({ ...prev, [key]: true }));
    const msg = messages[messageIndex];
    const proposal = msg.generatedOpps.opportunities[proposalIndex];
    const sourceMessage = msg.inquiryMessage || '';
    try {
      const r = await inquiryApi.saveOpp(currentId, proposal, sourceMessage);
      if (r.dropped) {
        setError({ kind: 'general', message: `Proposal dropped at quality gate: ${r.reason || 'unknown'}` });
      } else {
        // Record the persisted opp id so the UI can render a "View
        // opportunity →" breadcrumb. Without this the partner sees a
        // "Saved" chip but has no way to navigate to what they saved.
        setSavedOpps(prev => ({
          ...prev,
          [key]: { oppId: r.opportunity?.id, isNewProspect: r.isNewProspect }
        }));
      }
    } catch (err) {
      setError({ kind: 'general', message: friendlyError(err) });
    } finally {
      setSaving(prev => { const next = { ...prev }; delete next[key]; return next; });
    }
  };

  return (
    <div className="event-inquiry">
      <div className="event-inquiry-head">
        <h1>Event Inquiry</h1>
        <p className="caption">
          Describe an event in plain English — a sanctions designation, a regulatory action, a litigation
          filing. The agent searches public sources, identifies which of your clients and prospects are
          exposed, and proposes opportunities you can save individually.
        </p>
      </div>

      <div className="event-inquiry-stream" ref={streamRef}>
        {messages.length === 0 && (
          <div className="event-inquiry-suggestions">
            <div className="event-inquiry-suggestions-label">Try asking:</div>
            {STARTER_PROMPTS.map(p => (
              <button
                key={p}
                type="button"
                className="event-inquiry-suggestion"
                onClick={() => send(p)}
                disabled={busy}
              >
                <MessageCircle size={12} /> {p}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`event-inquiry-msg event-inquiry-msg-${m.role}`}>
            <div className="event-inquiry-msg-body">
              {m.role === 'assistant' ? <AcronymText>{m.content}</AcronymText> : m.content}
            </div>

            {/* Tool-use chips were here. Removed — the partner doesn't need
                to see which tool the assistant picked, only the answer. */}

            {/* Proposed opportunities the partner can save. */}
            {m.generatedOpps?.opportunities?.length > 0 && (
              <div className="event-inquiry-proposals">
                <div className="event-inquiry-proposals-head">
                  Proposed opportunities <span className="caption">({m.generatedOpps.opportunities.length})</span>
                </div>
                {m.generatedOpps.eventInterpretation && (
                  <div className="event-inquiry-event-interp">
                    <strong>Event interpretation:</strong> {m.generatedOpps.eventInterpretation}
                  </div>
                )}
                {m.generatedOpps.opportunities.map((p, j) => {
                  const key = `${i}:${j}`;
                  const savedInfo = savedOpps[key];
                  const isSaved = !!savedInfo;
                  const isSaving = !!saving[key];
                  return (
                    <div key={j} className={`event-inquiry-proposal ${isSaved ? 'saved' : ''}`}>
                      <div className="event-inquiry-proposal-head">
                        <div className="event-inquiry-proposal-entity">
                          {p.entity}
                          {p.isNewProspect && <span className="event-inquiry-newchip">NEW PROSPECT</span>}
                        </div>
                        <div className="event-inquiry-proposal-meta">
                          <span className="caption">{p.service?.replace(/_/g, ' ')}</span>
                          {p.urgency && <span className={`chip chip-${p.urgency === 'immediate' ? 'immediate' : p.urgency === 'this_week' ? 'this-week' : 'steady'}`}>{p.urgency.replace(/_/g, ' ')}</span>}
                          {typeof p.confidence === 'number' && <span className="caption">conf {Math.round(p.confidence * 100)}%</span>}
                          {typeof p.score === 'number' && <span className="caption">score {p.score}</span>}
                        </div>
                      </div>
                      {p.summary && <div className="event-inquiry-proposal-summary">{p.summary}</div>}
                      {p.reasoning && (
                        <details className="event-inquiry-proposal-reasoning">
                          <summary>Why</summary>
                          <div>{p.reasoning}</div>
                        </details>
                      )}
                      <div className="event-inquiry-proposal-actions">
                        {isSaved ? (
                          <>
                            <span className="event-inquiry-saved-chip"><Check size={12} /> Saved to opportunities</span>
                            {savedInfo.oppId && (
                              <Link
                                to={`/workspaces/${currentId}/opportunities/${savedInfo.oppId}`}
                                className="event-inquiry-saved-link"
                              >
                                View opportunity <ArrowRight size={12} />
                              </Link>
                            )}
                          </>
                        ) : (
                          <button
                            className="btn btn-accent btn-sm"
                            onClick={() => saveProposal(i, j)}
                            disabled={isSaving}
                          >
                            {isSaving ? <><Loader2 size={12} className="spin" /> Saving…</> : <><Plus size={12} /> Save to opportunities</>}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="event-inquiry-msg event-inquiry-msg-assistant event-inquiry-thinking">
            <Loader2 size={14} className="spin" /> thinking…
          </div>
        )}

        {error && (
          <div className={`event-inquiry-error ${error.kind === 'no_key' ? 'event-inquiry-error-key' : ''}`}>
            <AlertCircle size={14} />
            <span>{error.message}</span>
            {error.kind === 'no_key' && <Link to="/settings" className="event-inquiry-error-link">Configure key <ExternalLink size={11} /></Link>}
          </div>
        )}
      </div>

      <form className="event-inquiry-input-row" onSubmit={handleSubmit}>
        <Sparkles size={14} className="event-inquiry-input-icon" />
        <input
          type="text"
          className="event-inquiry-input"
          placeholder="Describe an event or paste a headline / URL…"
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={busy}
        />
        <button type="submit" className="btn btn-accent event-inquiry-send" disabled={busy || !input.trim()}>
          {busy ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
        </button>
      </form>
    </div>
  );
}
