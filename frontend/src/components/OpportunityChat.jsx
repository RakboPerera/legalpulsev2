import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Send, Sparkles, MessageCircle, Key } from 'lucide-react';
import { opportunities as oppApi } from '../api.js';
import AcronymText from './AcronymText.jsx';
import { friendlyError, isKeyError } from '../lib/errorMessages.js';

const SUGGESTED_PROMPTS = [
  'What does the source signal actually say?',
  'Why is this opportunity relevant to the firm?',
  'Which past matters does this build on?',
  'What would change this assessment?',
  'How fresh is the underlying evidence?'
];

/**
 * Per-opportunity chat panel. The agent on the backend gets the full
 * opportunity context (entity, signals, briefing, partner, matters) so the
 * conversation is grounded — partners can ask "what does the EDGAR filing
 * actually say" or "why this partner" and get answers tied to the specific
 * data backing the opportunity.
 *
 * Conversation is transient (not persisted to workspace chatHistory).
 */
export default function OpportunityChat({ workspaceId, opportunityId, entityName }) {
  const [messages, setMessages] = useState([]); // [{role, content, timestamp}]
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const streamRef = useRef(null);

  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [messages, busy]);

  const send = async (textOverride) => {
    const message = (textOverride ?? input).trim();
    if (!message || busy) return;
    setError(null);
    setBusy(true);
    const userMsg = { role: 'user', content: message, timestamp: new Date().toISOString() };
    const history = messages.map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    try {
      const r = await oppApi.chat(workspaceId, opportunityId, message, history);
      setMessages(prev => [...prev, r.message]);
    } catch (err) {
      setError({ text: friendlyError(err), needsKey: isKeyError(err) });
      // Drop the optimistic user message on error so they can retry without
      // the prompt being mysteriously already-sent.
      setMessages(prev => prev.slice(0, -1));
      setInput(message);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = e => {
    e.preventDefault();
    send();
  };

  return (
    <div className="opp-chat">
      <div className="opp-chat-head">
        <div className="opp-chat-title">
          <Sparkles size={16} />
          Ask about this opportunity
        </div>
        <div className="opp-chat-sub">
          Question the source signals, the relevance, the partner fit, the precedent. The agent has full context on this opportunity only.
        </div>
      </div>

      <div className="opp-chat-stream" ref={streamRef}>
        {messages.length === 0 && (
          <div className="opp-chat-suggestions">
            <div className="opp-chat-suggestions-label">Try asking:</div>
            {SUGGESTED_PROMPTS.map(p => (
              <button
                key={p}
                type="button"
                className="opp-chat-suggestion"
                onClick={() => send(p)}
                disabled={busy}
              >
                <MessageCircle size={12} /> {p}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`opp-chat-msg opp-chat-msg-${m.role}`}>
            {m.role === 'assistant' ? <AcronymText>{m.content}</AcronymText> : m.content}
          </div>
        ))}

        {busy && (
          <div className="opp-chat-msg opp-chat-msg-assistant opp-chat-thinking">
            <span className="opp-chat-dot" /><span className="opp-chat-dot" /><span className="opp-chat-dot" />
          </div>
        )}

        {error && (
          <div className="opp-chat-error" role="alert">
            {error.text}
            {error.needsKey && (
              <>{' '}<Link to="/settings" className="opp-chat-error-link"><Key size={11} /> Open Settings</Link></>
            )}
          </div>
        )}
      </div>

      <form className="opp-chat-input-row" onSubmit={handleSubmit}>
        <input
          type="text"
          className="opp-chat-input"
          placeholder={`Ask about ${entityName || 'this opportunity'}…`}
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={busy}
        />
        <button type="submit" className="btn btn-accent opp-chat-send" disabled={busy || !input.trim()}>
          <Send size={14} />
        </button>
      </form>
    </div>
  );
}
