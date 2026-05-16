import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Sparkles, RefreshCw } from 'lucide-react';
import { useWorkspace } from '../components/WorkspaceContext.jsx';
import { screening, opportunities as oppApi, workspaces as wsApi } from '../api.js';
import OppCard from '../components/OppCard.jsx';
import EventChat from '../components/EventChat.jsx';

function topicLabel(topic) {
  if (!topic) return 'General event';
  return topic.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function EventDetail() {
  const { id, eventKey } = useParams();
  const navigate = useNavigate();
  const { currentId } = useWorkspace();
  const wsId = id || currentId;
  const decodedKey = decodeURIComponent(eventKey);
  const [event, setEvent] = useState(null);
  const [signalsById, setSignalsById] = useState({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState([]); // opp records (raw shape from /generate)
  const [enrichedOpps, setEnrichedOpps] = useState([]); // refreshed via opportunities.list to get entityName etc.
  const [eventInterpretation, setEventInterpretation] = useState('');
  const [error, setError] = useState(null);

  // Load event metadata + any already-generated opps for this event.
  useEffect(() => {
    if (!wsId) return;
    setLoading(true);
    setError(null);
    // Trimmed fetches. The page only needs (a) this event, (b) its own
    // opportunities, (c) the signals cited by those opps. Loading 200
    // events + 500 opps + 500 signals on every mount is wasteful — a
    // partner clicking between events sees ~1-3 MB of JSON each click.
    Promise.all([
      screening.events(wsId, { region: 'all', industry: 'all', since: 'all', limit: 60, eventKey: decodedKey }),
      oppApi.list(wsId, { limit: 200, engineSource: 'market_screening', eventClusterKey: decodedKey }),
      wsApi.signals(wsId, { limit: 100, eventKey: decodedKey })
    ])
      .then(([evResp, oppResp, sigResp]) => {
        const evt = (evResp.events || []).find(e => e.eventKey === decodedKey);
        setEvent(evt || null);
        const sigMap = {};
        for (const s of (sigResp.signals || [])) sigMap[s.id] = s;
        setSignalsById(sigMap);
        const myOpps = (oppResp.opportunities || []).filter(
          o => o.engineSource === 'market_screening' && o.basis?.eventClusterKey === decodedKey
        );
        setEnrichedOpps(myOpps);
        if (myOpps.length) {
          // Pull eventInterpretation from any existing opp.
          setEventInterpretation(myOpps[0]?.basis?.eventInterpretation || '');
        }
      })
      .catch(err => setError(err.response?.data?.error || err.message))
      .finally(() => setLoading(false));
  }, [wsId, decodedKey]);

  const eventSignals = useMemo(() => {
    if (!event) return [];
    return (event.signalIds || []).map(id => signalsById[id]).filter(Boolean);
  }, [event, signalsById]);

  const runGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    try {
      const r = await screening.generate(wsId, decodedKey);
      setGenerated(r.opportunities || []);
      setEventInterpretation(r.eventInterpretation || '');
      // Re-fetch opps to get enriched fields (entityName, partner name, etc.)
      const oppResp = await oppApi.list(wsId, { limit: 500 });
      const myOpps = (oppResp.opportunities || []).filter(
        o => o.engineSource === 'market_screening' && o.basis?.eventClusterKey === decodedKey
      );
      setEnrichedOpps(myOpps);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setGenerating(false);
    }
  };

  const basePath = `/workspaces/${wsId}/outreach/screening`;
  const oppBasePath = `/workspaces/${wsId}`;

  if (loading) return <div className="screening-empty">Loading event…</div>;
  if (!event) {
    return (
      <div className="event-detail">
        <Link to={basePath} className="back-link"><ArrowLeft size={14} /> Back to events</Link>
        <p className="screening-empty">Event no longer in the cluster pool. The signal mix may have changed since the page was loaded.</p>
      </div>
    );
  }

  const hasOpps = enrichedOpps.length > 0;

  return (
    <div className="event-detail">
      <Link to={basePath} className="back-link"><ArrowLeft size={14} /> Back to events</Link>

      <div className="event-detail-head">
        <span className="chip event-card-topic">{topicLabel(event.eventTopic)}</span>
        {event.publishedAtMax && (
          <span className="event-detail-meta">{event.publishedAtMax.slice(0, 10)} · {event.signalCount} signals from {event.sourceCount} sources</span>
        )}
      </div>

      <h1 className="event-detail-headline">{event.headline}</h1>

      {eventInterpretation && (
        <div className="event-detail-interpretation">
          <h3>What this event is</h3>
          <p>{eventInterpretation}</p>
        </div>
      )}

      {/* Conversational interface — primary way the partner explores the event.
          Agent has access to cached signals + Tavily live search + opportunity
          identification on demand. */}
      <div className="event-detail-section">
        <EventChat
          workspaceId={wsId}
          eventKey={decodedKey}
          eventHeadline={event.headline}
        />
      </div>

      <div className="event-detail-section">
        <h3>Cited signals</h3>
        <ul className="event-detail-sources">
          {eventSignals.map(s => (
            <li key={s.id}>
              <span className="source-tag">{s.source}</span>
              <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer">
                {s.title} <ExternalLink size={11} />
              </a>
              {s.publishedAt && <span className="source-date"> · {s.publishedAt.slice(0, 10)}</span>}
            </li>
          ))}
        </ul>
      </div>

      <div className="event-detail-actions">
        {!hasOpps && (
          <button
            className="primary-button"
            onClick={runGenerate}
            disabled={generating}
          >
            <Sparkles size={14} />
            {generating ? ' Generating…' : ' Generate opportunities'}
          </button>
        )}
        {hasOpps && (
          <button
            className="secondary-button"
            onClick={runGenerate}
            disabled={generating}
            title="Re-runs the screening agent. Existing opps for this event are kept; only new ones are added."
          >
            <RefreshCw size={14} className={generating ? 'spin' : ''} />
            {generating ? ' Regenerating…' : ' Re-run agent'}
          </button>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {hasOpps && (
        <div className="event-detail-section">
          <h3>Opportunities ({enrichedOpps.length})</h3>
          <div className="event-detail-opps">
            {enrichedOpps.map(opp => (
              <OppCard key={opp.id} opp={opp} basePath={oppBasePath} />
            ))}
          </div>
        </div>
      )}

      {!hasOpps && !generating && (
        <p className="screening-hint">
          The agent will read the cited signals, identify which entities are central to this event (existing clients/prospects or new companies worth pursuing), and propose 1–5 concrete legal mandates with structured reasoning.
        </p>
      )}
    </div>
  );
}
