import React, { useEffect, useMemo, useState } from 'react';
import { X, Search } from 'lucide-react';
import { useWorkspace } from './WorkspaceContext.jsx';
import { opportunities as oppApi } from '../api.js';
import OppCard, { URGENCY_LABEL, prettyTrigger } from './OppCard.jsx';
import { prettyService } from '../lib/labels.js';

// Short labels for the filter row — kept tight so the row stays one line.
const SEVERITY_BUTTON = { p0: 'Critical', p1: 'High', p2: 'Standard', p3: 'Watching' };

/**
 * Shared opportunity board.
 *  - mode "existing": filters opps to entityType === client. Two columns:
 *    cross_sell + client-side event_intelligence.
 *  - mode "outreach": filters opps to entityType === prospect. Two columns:
 *    prospect_discovery + prospect-side event_intelligence.
 */
export default function OppBoard({ mode }) {
  const { current, currentId, viewingRunId, isViewingHistorical } = useWorkspace();
  const [opps, setOpps] = useState([]);
  const [filters, setFilters] = useState({
    urgency: 'all',
    region: 'all',
    service: 'all',
    severity: 'all',
    trigger: 'all',
    search: ''
  });
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!currentId) return;
    setError(null);
    // Pass viewingRunId so the server can serve archived-run data when the
    // user has flipped the switcher away from "live".
    const params = { limit: 300 };
    if (viewingRunId && viewingRunId !== 'live') params.runId = viewingRunId;
    oppApi.list(currentId, params)
      .then(r => setOpps(r.opportunities || []))
      .catch(err => setError(err.response?.data?.error || err.message));
  }, [currentId, viewingRunId]);

  const targetEntityType = mode === 'outreach' ? 'prospect' : 'client';
  const headerLabel = mode === 'outreach' ? 'New Client Outreach' : 'Existing Client Opportunities';
  const headerLede = mode === 'outreach'
    ? 'Win new clients. We surface external entities the firm has the expertise to serve, plus market events touching prospects already on the radar.'
    : 'Grow the book. We surface service gaps where industry peers use a service this client does not, plus market events touching clients you already serve.';
  const primaryEngine = mode === 'outreach' ? 'prospect_discovery' : 'cross_sell';
  const primaryHeader = mode === 'outreach' ? 'Prospect Discovery' : 'Cross-Sell';
  const primarySub = mode === 'outreach'
    ? 'External entities matching firm expertise based on detected signals.'
    : 'Existing clients with service gaps relative to peers in the same cluster.';
  const eventHeader = 'Event-Driven';
  const eventSub = mode === 'outreach'
    ? 'Time-sensitive market events touching prospects we are tracking.'
    : 'Time-sensitive market events touching the existing book.';

  const scoped = useMemo(
    // Exclude market_screening opps from the main board — they live in
    // their own "Market Screening" tab so partners only see those when
    // they explicitly opted in to that workflow.
    () => opps.filter(o => o.entityType === targetEntityType && o.engineSource !== 'market_screening'),
    [opps, targetEntityType]
  );

  // Derive available filter values from the current scoped opp set so dropdowns
  // never offer options that produce zero results.
  const availableRegions = useMemo(() => {
    const set = new Set();
    scoped.forEach(o => { if (o.entityJurisdiction) set.add(o.entityJurisdiction); });
    return Array.from(set).sort();
  }, [scoped]);
  const availableServices = useMemo(() => {
    const set = new Set();
    scoped.forEach(o => { if (o.suggestedService) set.add(o.suggestedService); });
    return Array.from(set).sort();
  }, [scoped]);
  // Derived from the trigger taxonomy on each opp — preserves the order the
  // taxonomy is defined in (most common → least common in our pipeline).
  const availableTriggers = useMemo(() => {
    const set = new Set();
    scoped.forEach(o => (o.triggers || []).forEach(t => set.add(t)));
    return Array.from(set).sort();
  }, [scoped]);
  const availableSeverities = useMemo(() => {
    const set = new Set();
    scoped.forEach(o => { if (o.severity) set.add(o.severity); });
    // Always order p0 → p3 so the chip row reads naturally.
    return ['p0', 'p1', 'p2', 'p3'].filter(s => set.has(s));
  }, [scoped]);

  const searchLower = filters.search.trim().toLowerCase();
  const filtered = useMemo(() => scoped.filter(o => {
    if (filters.urgency !== 'all' && o.urgencyTier !== filters.urgency) return false;
    if (filters.region !== 'all' && o.entityJurisdiction !== filters.region) return false;
    if (filters.service !== 'all' && o.suggestedService !== filters.service) return false;
    if (filters.severity !== 'all' && o.severity !== filters.severity) return false;
    if (filters.trigger !== 'all' && !(o.triggers || []).includes(filters.trigger)) return false;
    if (searchLower && !(o.entityName || '').toLowerCase().includes(searchLower)) return false;
    return true;
  }), [scoped, filters, searchLower]);

  const primary = filtered.filter(o => o.engineSource === primaryEngine);
  const eventDriven = filtered.filter(o => o.engineSource === 'event_intelligence');
  const filtersActive = filters.urgency !== 'all'
    || filters.region !== 'all' || filters.service !== 'all'
    || filters.severity !== 'all' || filters.trigger !== 'all'
    || filters.search !== '';
  const clearFilters = () => setFilters({ urgency: 'all', region: 'all', service: 'all', severity: 'all', trigger: 'all', search: '' });

  const sanctionsCount = scoped.filter(o => o.isSanctionsAlert).length;
  const immediateCount = scoped.filter(o => o.urgencyTier === 'immediate').length;
  const briefingCount = scoped.filter(o => o.hasBriefing).length;

  const basePath = `/workspaces/${currentId}`;

  return (
    <div>
      <div className="board-intro">
        <div className="board-intro-head">
          <h1>{headerLabel}</h1>
          <span className="board-intro-count">
            <span className="board-intro-count-num">{scoped.length}</span>
            <span className="board-intro-count-label">opportunit{scoped.length === 1 ? 'y' : 'ies'} surfaced</span>
          </span>
        </div>
        <p className="board-intro-lede">{headerLede}</p>

        {error && <div className="banner-warn" style={{ marginBottom: 12 }}>Failed to load opportunities: {error}</div>}

        {sanctionsCount > 0 && (
          <div className="sanctions-strip">
            <strong>{sanctionsCount} compliance alert{sanctionsCount === 1 ? '' : 's'}</strong>
            {' '}— sanctions cross-reference matched {targetEntityType === 'client' ? 'an existing client' : 'a prospect'}.
            Escalate to compliance before any outreach.
          </div>
        )}

        <div className="board-intro-stats">
          <div className="board-intro-stat">
            <div className="board-intro-stat-num">{primary.length}</div>
            <div className="board-intro-stat-label">{primaryHeader}</div>
            <div className="board-intro-stat-sub">{primarySub}</div>
          </div>
          <div className="board-intro-stat">
            <div className="board-intro-stat-num">{eventDriven.length}</div>
            <div className="board-intro-stat-label">Event-Driven</div>
            <div className="board-intro-stat-sub">Time-sensitive market events {targetEntityType === 'client' ? 'on the existing book' : 'on tracked prospects'}.</div>
          </div>
          <div className="board-intro-stat board-intro-stat-accent">
            <div className="board-intro-stat-num">{immediateCount}</div>
            <div className="board-intro-stat-label">Immediate</div>
            <div className="board-intro-stat-sub">Act now or lose the window.</div>
          </div>
          <div className="board-intro-stat">
            <div className="board-intro-stat-num">{briefingCount}</div>
            <div className="board-intro-stat-label">Briefings ready</div>
            <div className="board-intro-stat-sub">Cited &amp; sourced.</div>
          </div>
        </div>
      </div>

      <div className="opp-filter-bar">
        <div className="opp-filter-group opp-filter-group-search">
          <Search size={14} className="opp-filter-search-icon" />
          <input
            type="text"
            className="opp-filter-search"
            placeholder={targetEntityType === 'client' ? 'Search clients…' : 'Search prospects…'}
            value={filters.search}
            onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
          />
        </div>

        <div className="opp-filter-group">
          <label className="opp-filter-label">Region</label>
          <select className="opp-filter-select" value={filters.region} onChange={e => setFilters(f => ({ ...f, region: e.target.value }))}>
            <option value="all">All regions</option>
            {availableRegions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <div className="opp-filter-group">
          <label className="opp-filter-label">Service</label>
          <select className="opp-filter-select" value={filters.service} onChange={e => setFilters(f => ({ ...f, service: e.target.value }))}>
            <option value="all">All services</option>
            {availableServices.map(s => <option key={s} value={s}>{prettyService(s)}</option>)}
          </select>
        </div>

        {availableTriggers.length > 0 && (
          <div className="opp-filter-group">
            <label className="opp-filter-label">Risk domain</label>
            <select className="opp-filter-select" value={filters.trigger} onChange={e => setFilters(f => ({ ...f, trigger: e.target.value }))}>
              <option value="all">All domains</option>
              {availableTriggers.map(t => <option key={t} value={t}>{prettyTrigger(t)}</option>)}
            </select>
          </div>
        )}

        {availableSeverities.length > 0 && (
          <div className="opp-filter-group opp-filter-urgency-group">
            <label className="opp-filter-label">Severity</label>
            <div className="opp-filter-chip-row">
              {['all', ...availableSeverities].map(s => (
                <button
                  type="button"
                  key={s}
                  className={`chip ${filters.severity === s ? 'active' : ''}`}
                  onClick={() => setFilters(f => ({ ...f, severity: s }))}
                >
                  {s === 'all' ? 'All' : SEVERITY_BUTTON[s] || s.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="opp-filter-group opp-filter-urgency-group">
          <label className="opp-filter-label">Urgency</label>
          <div className="opp-filter-chip-row">
            {['all', 'immediate', 'this_week', 'steady_state'].map(u => (
              <button
                type="button"
                key={u}
                className={`chip ${filters.urgency === u ? 'active' : ''}`}
                onClick={() => setFilters(f => ({ ...f, urgency: u }))}
              >
                {u === 'all' ? 'All' : URGENCY_LABEL[u]}
              </button>
            ))}
          </div>
        </div>

        {filtersActive && (
          <button className="btn btn-secondary opp-filter-clear" onClick={clearFilters}>
            <X size={12} /> Clear
          </button>
        )}
      </div>

      {filtersActive && (
        <p className="opp-filter-resultcount caption">
          Showing {filtered.length} of {scoped.length} opportunit{scoped.length === 1 ? 'y' : 'ies'}.
        </p>
      )}

      <div className="dashboard-columns dashboard-columns-2">
        <div className="dashboard-column">
          <h2>{primaryHeader}</h2>
          <p className="col-caption">{primarySub}</p>
          {primary.length === 0 ? (
            <div className="empty-state">
              {filtersActive
                ? <>No {primaryHeader.toLowerCase()} opportunities match the current filters. <button className="btn-link" onClick={clearFilters}>Clear filters</button>.</>
                : <>No {primaryHeader.toLowerCase()} opportunities yet — run the pipeline on <a href={`${basePath}/sources`}>Signals &amp; sources</a> to surface fresh opportunities.</>}
            </div>
          ) : primary.slice(0, 30).map(o => <OppCard key={o.id} opp={o} basePath={basePath} />)}
        </div>
        <div className="dashboard-column">
          <h2>{eventHeader}</h2>
          <p className="col-caption">{eventSub}</p>
          {eventDriven.length === 0 ? (
            <div className="empty-state">
              {filtersActive
                ? <>No event-driven opportunities match the current filters. <button className="btn-link" onClick={clearFilters}>Clear filters</button>.</>
                : <>No event-driven opportunities yet — run the pipeline on <a href={`${basePath}/sources`}>Signals &amp; sources</a> to surface fresh events.</>}
            </div>
          ) : eventDriven.slice(0, 30).map(o => <OppCard key={o.id} opp={o} basePath={basePath} />)}
        </div>
      </div>
    </div>
  );
}
