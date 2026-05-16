import React, { useEffect, useState, useCallback } from 'react';
import { useWorkspace } from '../components/WorkspaceContext.jsx';
import { workspaces as wsApi } from '../api.js';
import SignalAuditTable from '../components/SignalAuditTable.jsx';
import OppsConsideredTab from '../components/OppsConsideredTab.jsx';
import { useTitle } from '../lib/useTitle.js';

// Reasoning Trail page — two tabs around a single clear purpose:
// "For every signal we ingested, show what the system did with it and why."
//
//   1. Signals  — per-signal audit ledger (the primary surface)
//   2. Opportunities considered — every (entity × service) candidate, surfaced or rejected
//
// Both views are filterable, both ground in the same workspace state,
// neither uses the prior survivor-centric framing.
const DEFAULT_FILTERS = { source: 'all', disposition: 'all', entity: 'all', q: '', offset: 0, limit: 50 };

export default function ReasoningTrail() {
  useTitle('Signal & reasoning audit');
  const { currentId } = useWorkspace();
  const [tab, setTab] = useState('signals'); // signals | considered
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback((f) => {
    if (!currentId) return;
    setLoading(true);
    setError(null);
    wsApi.reasoning(currentId, f)
      .then(d => { setData(d); setLoading(false); })
      .catch(err => { setError(err.response?.data?.error || err.message); setLoading(false); });
  }, [currentId]);

  useEffect(() => { fetchData(filters); }, [filters, fetchData]);

  const onFilter = (patch) => {
    setFilters(f => ({ ...f, ...patch, offset: 0 })); // reset paging on any filter change
  };
  const onLoadMore = (newOffset) => {
    // Append-style "load more": refetch with new offset but keep items
    // accumulated. To keep state simple we just bump offset and refetch
    // — the table is currently page-replacement, not append. (50 rows
    // per page is plenty for browsing; rare to need cumulative scroll.)
    setFilters(f => ({ ...f, offset: newOffset }));
  };

  return (
    <div className="reasoning-trail">
      <h1>Signal &amp; reasoning audit</h1>
      <p className="caption">
        How each input signal was processed — what was flagged, what was filtered, what fed an opportunity, and why.
      </p>

      <div className="reasoning-tabs">
        <button
          type="button"
          className={`reasoning-tab ${tab === 'signals' ? 'active' : ''}`}
          onClick={() => setTab('signals')}
        >
          Signals
          {data && <span className="reasoning-tab-count">{data.summary.deduped}</span>}
        </button>
        <button
          type="button"
          className={`reasoning-tab ${tab === 'considered' ? 'active' : ''}`}
          onClick={() => setTab('considered')}
        >
          Opportunities considered
          {data?.consideredOpportunities && (
            <span className="reasoning-tab-count">
              {(data.consideredOpportunities.surfaced?.length || 0) + (data.consideredOpportunities.rejected?.length || 0)}
            </span>
          )}
        </button>
      </div>

      {loading && !data && <div className="caption">Loading audit…</div>}
      {error && <div className="banner-warn">Failed to load: {error}</div>}

      {data && tab === 'signals' && (
        <SignalAuditTable
          data={data}
          filters={filters}
          onFilter={onFilter}
          onLoadMore={onLoadMore}
        />
      )}

      {data && tab === 'considered' && (
        <OppsConsideredTab data={data.consideredOpportunities} />
      )}
    </div>
  );
}
