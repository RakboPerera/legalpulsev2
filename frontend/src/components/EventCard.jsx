import React from 'react';
import { Link } from 'react-router-dom';
import { Globe, Layers, Clock, Sparkles } from 'lucide-react';

function recencyLabel(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  const days = Math.max(0, Math.round((Date.now() - t) / 86400000));
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  return `${Math.round(days / 30)}mo ago`;
}

function topicLabel(topic) {
  if (!topic) return 'General event';
  return topic.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function EventCard({ event, basePath }) {
  const recency = recencyLabel(event.publishedAtMax);
  const corroborated = event.sourceCount >= 2 || event.signalCount >= 3;
  return (
    <Link to={`${basePath}/${encodeURIComponent(event.eventKey)}`} className="event-card-link">
      <div className="event-card">
        <div className="event-card-meta">
          <span className="chip event-card-topic">{topicLabel(event.eventTopic)}</span>
          {corroborated && (
            <span className="event-card-corroborated" title={`${event.signalCount} signals from ${event.sourceCount} sources`}>
              <Layers size={11} /> {event.sourceCount} sources
            </span>
          )}
          {recency && (
            <span className="event-card-recency"><Clock size={11} /> {recency}</span>
          )}
          <span className="event-card-spacer" />
          {event.generatedOppCount > 0 && (
            <span className="event-card-generated" title="Opportunities already generated for this event">
              <Sparkles size={11} /> {event.generatedOppCount} generated
            </span>
          )}
        </div>
        <h3 className="event-card-headline">{event.headline}</h3>
        {event.summary && <p className="event-card-summary">{event.summary}</p>}
        <div className="event-card-footer">
          {(event.jurisdictions || []).slice(0, 4).map(j => (
            <span key={j} className="event-card-juris"><Globe size={10} /> {j}</span>
          ))}
          {(event.industries || []).slice(0, 3).map(i => (
            <span key={i} className="event-card-industry">{i.replace(/_/g, ' ')}</span>
          ))}
        </div>
      </div>
    </Link>
  );
}
