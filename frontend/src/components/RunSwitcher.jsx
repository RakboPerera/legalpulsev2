import React, { useState, useRef, useEffect } from 'react';
import { History, Check, Radio, ChevronDown } from 'lucide-react';
import { useWorkspace } from './WorkspaceContext.jsx';

/**
 * Pipeline run history dropdown.
 *
 * Renders a compact pill with the currently-viewed run label. Clicking it
 * opens a dropdown of:
 *   - Live · current (the workspace's active state)
 *   - Each archived run (most recent first), with completion timestamp +
 *     counts so the user can recognise the run by content.
 *
 * Sets `viewingRunId` on the WorkspaceContext when a run is selected;
 * components that read opps/signals/briefings thread that into their API
 * calls as `?runId=<id>`. Hidden entirely when there's no archived
 * history yet — the switcher only adds value once a pipeline run has
 * archived something.
 */
export default function RunSwitcher() {
  const { runsList, viewingRunId, setViewingRunId, isViewingHistorical } = useWorkspace();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click — the standard dropdown pattern.
  useEffect(() => {
    if (!open) return;
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // No history → no switcher. The "Live" view is the only option, so
  // surfacing a dropdown with one item is just noise.
  if (!runsList?.history?.length) return null;

  const activeRun = !viewingRunId || viewingRunId === 'live'
    ? runsList.live
    : runsList.history.find(r => r.id === viewingRunId) || runsList.live;
  const activeLabel = activeRun?.label || 'Live · current';

  const handleSelect = (runId) => {
    setViewingRunId(runId === 'live' ? null : runId);
    setOpen(false);
  };

  return (
    <div className={`run-switcher ${isViewingHistorical ? 'historical' : ''}`} ref={ref}>
      <button
        type="button"
        className="run-switcher-trigger"
        onClick={() => setOpen(v => !v)}
        title="Switch between pipeline runs"
      >
        {isViewingHistorical ? <History size={12} /> : <Radio size={12} />}
        <span className="run-switcher-current">{activeLabel}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="run-switcher-menu">
          <button
            type="button"
            className={`run-switcher-item ${!isViewingHistorical ? 'active' : ''}`}
            onClick={() => handleSelect('live')}
          >
            <div className="run-switcher-item-head">
              <Radio size={12} />
              <span className="run-switcher-item-label">Live · current</span>
              {!isViewingHistorical && <Check size={12} className="run-switcher-check" />}
            </div>
            {runsList.live?.counts && (
              <div className="run-switcher-item-meta">
                {runsList.live.counts.signals} signals · {runsList.live.counts.opportunities} opps · {runsList.live.counts.briefings} briefings
              </div>
            )}
          </button>
          <div className="run-switcher-divider" />
          {runsList.history.map(run => (
            <button
              key={run.id}
              type="button"
              className={`run-switcher-item ${viewingRunId === run.id ? 'active' : ''}`}
              onClick={() => handleSelect(run.id)}
            >
              <div className="run-switcher-item-head">
                <History size={12} />
                <span className="run-switcher-item-label">{run.label}</span>
                {viewingRunId === run.id && <Check size={12} className="run-switcher-check" />}
              </div>
              <div className="run-switcher-item-meta">
                {run.counts?.signals || 0} signals · {run.counts?.opportunities || 0} opps · {run.counts?.briefings || 0} briefings
                {run.completedAt && <> · {new Date(run.completedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
