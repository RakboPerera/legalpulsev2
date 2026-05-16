import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, CheckCircle2, AlertTriangle, X } from 'lucide-react';

// Second tab of the Reasoning Trail: every (entity × service) candidate
// the system proposed, partitioned into surfaced (passed / demoted) vs
// rejected (with curated reason text). Distinct audit from the per-
// signal table — same data could be sliced this way to answer "which
// opps did we consider but choose not to surface".
//
// Props:
//   data — consideredOpportunities from /reasoning endpoint:
//     { surfaced: [...], rejected: [...], reasonTaxonomy: {...} }
export default function OppsConsideredTab({ data }) {
  const [openId, setOpenId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all'); // all / passed / demoted / rejected
  const [reasonFilter, setReasonFilter] = useState('all');

  const { surfaced = [], rejected = [], reasonTaxonomy = {} } = data || {};

  // Combine into one list so the partner can scan all candidates in one place.
  const all = useMemo(() => {
    const fromSurfaced = surfaced.map(o => ({ ...o, kind: 'surfaced' }));
    const fromRejected = rejected.map(o => ({ ...o, kind: 'rejected' }));
    return [...fromSurfaced, ...fromRejected];
  }, [surfaced, rejected]);

  const reasonCounts = useMemo(() => {
    const c = {};
    for (const r of rejected) c[r.reasonCode] = (c[r.reasonCode] || 0) + 1;
    return c;
  }, [rejected]);

  const filtered = all.filter(o => {
    if (statusFilter !== 'all') {
      if (statusFilter === 'rejected' && o.kind !== 'rejected') return false;
      if (statusFilter === 'passed'   && (o.kind !== 'surfaced' || o.status !== 'passed')) return false;
      if (statusFilter === 'demoted'  && (o.kind !== 'surfaced' || o.status !== 'demoted')) return false;
    }
    if (reasonFilter !== 'all' && o.reasonCode !== reasonFilter) return false;
    return true;
  });

  const surfacedPassed = surfaced.filter(o => o.status === 'passed').length;
  const surfacedDemoted = surfaced.filter(o => o.status === 'demoted').length;

  return (
    <div className="opps-considered">
      <div className="audit-summary">
        <div className="audit-summary-row">
          <Stat label="Candidates considered" value={all.length} />
          <span className="audit-arrow">→</span>
          <Stat label="Surfaced (passed)" value={surfacedPassed} variant="good" />
          <Stat label="Surfaced (demoted)" value={surfacedDemoted} variant="caution" />
          <Stat label="Rejected" value={rejected.length} variant="weak" />
        </div>
      </div>

      <div className="audit-filters">
        <div className="audit-filter-row">
          <span className="audit-filter-label">Status:</span>
          {['all', 'passed', 'demoted', 'rejected'].map(s => (
            <span
              key={s}
              className={`chip ${statusFilter === s ? 'active' : ''}`}
              onClick={() => setStatusFilter(s)}
            >{s}</span>
          ))}
        </div>

        {Object.keys(reasonCounts).length > 0 && (
          <div className="audit-filter-row">
            <span className="audit-filter-label">Rejection reason:</span>
            <span
              className={`chip ${reasonFilter === 'all' ? 'active' : ''}`}
              onClick={() => setReasonFilter('all')}
            >all ({rejected.length})</span>
            {Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]).map(([code, n]) => (
              <span
                key={code}
                className={`chip reason-chip reason-${code} ${reasonFilter === code ? 'active' : ''}`}
                onClick={() => { setReasonFilter(code); setStatusFilter('rejected'); }}
                title={reasonTaxonomy[code] || code}
              >{code.replace(/_/g, ' ')} ({n})</span>
            ))}
          </div>
        )}
      </div>

      <div className="opps-considered-list">
        {filtered.length === 0 ? (
          <div className="empty-state">No candidates match these filters.</div>
        ) : (
          filtered.map(o => (
            <OppRow
              key={`${o.kind}-${o.id}`}
              opp={o}
              open={openId === `${o.kind}-${o.id}`}
              onToggle={() => setOpenId(openId === `${o.kind}-${o.id}` ? null : `${o.kind}-${o.id}`)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, variant }) {
  return (
    <span className={`audit-stat audit-stat-${variant || 'default'}`}>
      <span className="audit-stat-value">{(value ?? 0).toLocaleString()}</span>
      <span className="audit-stat-label">{label}</span>
    </span>
  );
}

function OppRow({ opp, open, onToggle }) {
  const isRejected = opp.kind === 'rejected';
  const isDemoted = opp.kind === 'surfaced' && opp.status === 'demoted';
  return (
    <div className={`rejection-card ${isRejected ? '' : (isDemoted ? 'rejection-demoted' : 'rejection-surfaced')}`}>
      <button type="button" className="rejection-header" onClick={onToggle}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="rejection-entity">
          <strong>{opp.entityName}</strong>
          <span className="caption" style={{ marginLeft: 8 }}>
            × {opp.service?.replace(/_/g, ' ')}
          </span>
        </span>
        <span className="rejection-meta">
          {isRejected ? (
            <span className="critic-flag rejected"><X size={12} /> rejected</span>
          ) : isDemoted ? (
            <span className="critic-flag"><AlertTriangle size={12} /> demoted</span>
          ) : (
            <span className="critic-pass"><CheckCircle2 size={12} /> surfaced</span>
          )}
          {opp.reasonCode && (
            <span className={`chip reason-chip reason-${opp.reasonCode}`}>
              {opp.reasonCode.replace(/_/g, ' ')}
            </span>
          )}
          {typeof opp.score === 'number' && (
            <span className="chip">score {opp.score}</span>
          )}
          {typeof opp.originalScore === 'number' && isRejected && (
            <span className="chip">heuristic {opp.originalScore}</span>
          )}
        </span>
      </button>

      {open && (
        <div className="rejection-body">
          {isRejected ? (
            <>
              <div className="rejection-reason-text">{opp.reasonText}</div>
              {opp.signals?.length > 0 && (
                <div className="rejection-signals">
                  <h5>Cited signals ({opp.signals.length})</h5>
                  {opp.signals.map(sg => (
                    <div key={sg.id} className="rejection-signal">
                      <div className="rejection-signal-head">
                        <span className="chip">{sg.source}</span>
                        <span className="caption">{(sg.publishedAt || '').slice(0, 10)}</span>
                        {sg.url && (
                          <a href={sg.url} target="_blank" rel="noreferrer" className="caption">
                            source <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                      <div className="rejection-signal-title">{sg.title}</div>
                      {sg.excerpt && <div className="caption rejection-signal-excerpt">"{sg.excerpt}"</div>}
                    </div>
                  ))}
                </div>
              )}
              <div className="rejection-meta-row caption">
                Proposed by: <strong>{opp.engineSource}</strong> · Dropped by: <strong>{opp.droppedBy}</strong>
                {opp.droppedAt && <> · {opp.droppedAt.slice(0, 10)}</>}
              </div>
            </>
          ) : (
            <>
              {opp.summary && <div className="rejection-reason-text">{opp.summary}</div>}
              {opp.reasoning && opp.reasoning !== opp.summary && (
                <div className="caption" style={{ marginTop: 6 }}>{opp.reasoning}</div>
              )}
              {isDemoted && opp.criticIssues?.length > 0 && (
                <div className="lineage-critic-demoted" style={{ marginTop: 12 }}>
                  <AlertTriangle size={14} /> <strong>Critic flagged</strong>
                  <ul style={{ margin: '4px 0 0 18px' }}>
                    {opp.criticIssues.map((iss, i) => <li key={i} className="caption">{iss}</li>)}
                  </ul>
                </div>
              )}
              <div className="rejection-meta-row caption">
                Proposed by: <strong>{opp.engineSource}</strong> ·
                Status: <strong>{opp.status}</strong> · Cited signals: <strong>{opp.signalIds?.length || 0}</strong>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
