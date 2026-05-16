import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useWorkspace } from '../components/WorkspaceContext.jsx';
import { screening } from '../api.js';
import EventCard from '../components/EventCard.jsx';

// Filter options
const REGIONS = ['all', 'USA', 'UK', 'EU', 'Other'];
const INDUSTRIES = ['all', 'oil_gas', 'banking', 'shipping', 'pharma', 'technology', 'automotive', 'fintech', 'commodities', 'telecoms', 'defense_aerospace', 'semiconductors'];
const TIME_BANDS = [
  { value: '24h', label: 'Last 24h' },
  { value: '7d', label: 'Last week' },
  { value: '30d', label: 'Last month' },
  { value: 'all', label: 'All time' }
];

function prettyIndustry(i) {
  if (i === 'all') return 'All industries';
  return i.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function MarketScreening() {
  const { id } = useParams();
  const { currentId } = useWorkspace();
  const wsId = id || currentId;
  const [filters, setFilters] = useState({ region: 'all', industry: 'all', since: '7d' });
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!wsId) return;
    setLoading(true);
    setError(null);
    const handle = setTimeout(() => {
      screening.events(wsId, filters)
        .then(r => setEvents(r.events || []))
        .catch(err => setError(err.response?.data?.error || err.message))
        .finally(() => setLoading(false));
    }, 200); // debounce filter changes
    return () => clearTimeout(handle);
  }, [wsId, filters]);

  const setFilter = (key, value) => setFilters(f => ({ ...f, [key]: value }));

  const basePath = `/workspaces/${wsId}/outreach/screening`;

  return (
    <div className="market-screening">
      <div className="board-intro">
        <div className="board-intro-head">
          <h1>Market Screening</h1>
          <span className="board-intro-count">
            <span className="board-intro-count-num">{events.length}</span>
            <span className="board-intro-count-label">major development{events.length === 1 ? '' : 's'}</span>
          </span>
        </div>
        <p className="board-intro-lede">
          Scan global news for distinct happenings — geopolitical, economic, regulatory — and ask the agent which legal opportunities each event creates. Click any development to generate fresh opportunities, including new companies the firm could pursue.
        </p>
      </div>

      <div className="screening-filters">
        <div className="screening-filter-group">
          <span className="screening-filter-label">Region</span>
          {REGIONS.map(r => (
            <button
              key={r}
              className={`chip ${filters.region === r ? 'active' : ''}`}
              onClick={() => setFilter('region', r)}
            >
              {r === 'all' ? 'All' : r}
            </button>
          ))}
        </div>
        <div className="screening-filter-group">
          <span className="screening-filter-label">Industry</span>
          <select
            value={filters.industry}
            onChange={e => setFilter('industry', e.target.value)}
            className="screening-filter-select"
          >
            {INDUSTRIES.map(i => <option key={i} value={i}>{prettyIndustry(i)}</option>)}
          </select>
        </div>
        <div className="screening-filter-group">
          <span className="screening-filter-label">Time</span>
          {TIME_BANDS.map(b => (
            <button
              key={b.value}
              className={`chip ${filters.since === b.value ? 'active' : ''}`}
              onClick={() => setFilter('since', b.value)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error-banner">Could not load events: {error}</div>}

      {loading && events.length === 0 && (
        <div className="screening-empty">Loading events…</div>
      )}

      {!loading && events.length === 0 && !error && (
        <div className="screening-empty">
          No major developments match the current filter — try widening region or time band.
        </div>
      )}

      <div className="screening-events">
        {events.map(ev => (
          <EventCard key={ev.eventKey} event={ev} basePath={basePath} />
        ))}
      </div>
    </div>
  );
}
