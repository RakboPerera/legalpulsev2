import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Send, Sparkles, MessageCircle, Globe, Layers, Key } from 'lucide-react';
import { screening } from '../api.js';
import AcronymText from './AcronymText.jsx';
import { friendlyError, isKeyError } from '../lib/errorMessages.js';

const SUGGESTED_PROMPTS = [
  'What is this event actually about?',
  'Which of our clients are exposed and how?',
  'What BD opportunities does this create?',
  'Are there similar precedents I should know about?',
  'What\'s the latest on this — anything broken in the last 24h?'
];

const TOOL_LABELS = {
  tavily_search: { label: 'Searched the web', icon: Globe },
  identify_opportunities: { label: 'Identified opportunities', icon: Layers }
};

/**
 * Per-event chat panel — sits inside EventDetail. The agent has access to
 * the event cluster's signals + workspace roster, plus two tools:
 *   - tavily_search (live web search for fresh context)
 *   - identify_opportunities (run the screener for this event)
 * Tool-use indicators surface when the agent calls a tool so the partner
 * sees the work happening.
 *
 * Conversation is transient (session-scoped, not persisted to workspace).
 */
export default function EventChat({ workspaceId, eventKey, eventHeadline }) {
  const [messages, setMessages] = useState([]); // [{role, content, toolsUsed?, generatedOpps?, timestamp}]
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
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
    const history = messages.map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    try {
      const r = await screening.chat(workspaceId, eventKey, message, history);
      setMessages(prev => [...prev, r.message]);
    } catch (err) {
      setError({ text: friendlyError(err), needsKey: isKeyError(err) });
      setMessages(prev => prev.slice(0, -1));
      setInput(message);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = e => { e.preventDefault(); send(); };

  return (
    <div className="opp-chat event-chat">
      <div className="opp-chat-head">
        <div className="opp-chat-title">
          <Sparkles size={16} />
          Ask about this event
        </div>
        <div className="opp-chat-sub">
          The assistant has the cited signals and can pull fresh news on demand. Ask anything — exposure, defence strategy, who to call first.
        </div>
      </div>

      <div className="opp-chat-stream" ref={streamRef}>
        {messages.length === 0 && (
          <div className="opp-chat-suggestions">
            <div className="opp-chat-suggestions-label">Try asking:</div>
            {SUGGESTED_PROMPTS.map(p => (
              <button key={p} type="button" className="opp-chat-suggestion" onClick={() => send(p)} disabled={busy}>
                <MessageCircle size={12} /> {p}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`opp-chat-msg opp-chat-msg-${m.role}`}>
            {m.role === 'assistant' ? <AcronymText>{m.content}</AcronymText> : m.content}
            {/* Inline opportunity cards when the agent ran identify_opportunities */}
            {m.role === 'assistant' && m.generatedOpps?.opportunities?.length > 0 && (
              <div className="event-chat-inline-opps">
                <div className="event-chat-inline-opps-label">{m.generatedOpps.opportunities.length} opportunities identified</div>
                {m.generatedOpps.opportunities.map((o, j) => (
                  <div key={j} className="event-chat-inline-opp">
                    <div className="event-chat-inline-opp-head">
                      <span className="event-chat-inline-opp-entity">
                        {o.entity}
                        {o.isNewProspect && <span className="event-chat-new-prospect-tag">NEW</span>}
                      </span>
                      <span className="event-chat-inline-opp-service">{(o.service || '').replace(/_/g, ' ')}</span>
                    </div>
                    <div className="event-chat-inline-opp-summary">{o.summary}</div>
                  </div>
                ))}
                <div className="event-chat-inline-opps-hint">
                  Click "Generate opportunities" above to persist these into the workspace and chat per-opp.
                </div>
              </div>
            )}
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
          placeholder={`Ask about ${eventHeadline ? eventHeadline.slice(0, 50) + '…' : 'this event'}`}
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
