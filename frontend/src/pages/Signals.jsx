import React, { useEffect, useState } from 'react';
import { useWorkspace } from '../components/WorkspaceContext.jsx';
import { workspaces as wsApi } from '../api.js';
import { prettySource } from '../lib/labels.js';
import { friendlyError } from '../lib/errorMessages.js';
import { useTitle } from '../lib/useTitle.js';

export default function Signals() {
  useTitle('Signals');
  const { currentId, viewingRunId } = useWorkspace();
  const [signals, setSignals] = useState([]);
  const [total, setTotal] = useState(0);
  const [source, setSource] = useState('all');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!currentId) return;
    setError(null);
    const params = { limit: 200 };
    if (source !== 'all') params.source = source;
    // Pass the active runId so historical-run views read the archived
    // signal pool instead of live state.
    if (viewingRunId && viewingRunId !== 'live') params.runId = viewingRunId;
    wsApi.signals(currentId, params)
      .then(r => { setSignals(r.signals || []); setTotal(r.total || 0); })
      .catch(err => setError(friendlyError(err)));
  }, [currentId, source, viewingRunId]);

  const sources = Array.from(new Set(signals.map(s => s.source)));

  return (
    <div>
      <h1>Signals</h1>
      {error && <div className="banner-warn" style={{ marginBottom: 12 }}>Failed to load signals: {error}</div>}
      <p className="caption">Ingested signals — {total} total in the workspace. Filter by source.</p>
      <div className="filter-bar">
        <button type="button" className={`chip ${source === 'all' ? 'active' : ''}`} onClick={() => setSource('all')}>All</button>
        {sources.map(s => (
          <button type="button" key={s} className={`chip ${source === s ? 'active' : ''}`} onClick={() => setSource(s)}>{prettySource(s)}</button>
        ))}
      </div>
      <div>
        {signals.slice(0, 100).map(s => (
          <div key={s.id} className="signal-row">
            <span className="src">{prettySource(s.source)}</span>
            <span>
              <a href={s.sourceUrl} target="_blank" rel="noreferrer">{s.title}</a>
              <div className="caption">{(s.entities || []).map(e => e.mentionedAs).join(', ')}</div>
            </span>
            <span className="caption">{s.publishedAt?.slice(0, 10)}</span>
            <span className="caption">{s.isLegallySignificant ? '✓ legally significant' : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
