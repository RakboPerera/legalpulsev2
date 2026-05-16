import React, { useEffect, useMemo, useState } from 'react';
import { useWorkspace } from '../components/WorkspaceContext.jsx';
import { workspaces as wsApi } from '../api.js';
import { ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
import { useTitle } from '../lib/useTitle.js';

const TYPE_OPTIONS = [
  { id: 'all', label: 'All activity' },
  { id: 'ingestion', label: 'Ingestion' },
  { id: 'classification', label: 'Classification' },
  { id: 'engine_run', label: 'Engine runs' },
  { id: 'briefing_generation', label: 'Briefings' },
  { id: 'user_action', label: 'User actions' }
];

const TYPE_LABEL = Object.fromEntries(TYPE_OPTIONS.map(t => [t.id, t.label]));

function titleFromEntry(e) {
  // Pull a one-line description from the most informative fields the entry
  // happens to carry. The schema isn’t fully uniform across audit types, so
  // this falls through several known field names rather than dumping JSON.
  const o = e.outputs || {};
  if (o.summary) return o.summary;
  if (o.title) return o.title;
  if (o.headline) return o.headline;
  if (o.briefingId && o.oneLineHeadline) return o.oneLineHeadline;
  if (o.engineName) {
    const opps = o.opportunitiesCreated ?? o.opportunities ?? o.count;
    return `${labelize(o.engineName)} produced ${opps ?? '—'} opportunit${opps === 1 ? 'y' : 'ies'}`;
  }
  if (o.classifierVerdict) return `Classifier: ${labelize(o.classifierVerdict)}`;
  if (o.signalsClassified) return `Classified ${o.signalsClassified} signals`;
  if (e.type === 'ingestion' && o.source) return `${labelize(o.source)} — ${o.signalsAdded ?? o.count ?? '—'} signals`;
  if (e.type === 'user_action' && o.action) return `User: ${labelize(o.action)}`;
  return labelize(e.type) + ' event';
}

function labelize(s) {
  if (!s || typeof s !== 'string') return s;
  return s.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
}

function fmtTime(ts) {
  if (!ts) return '';
  return ts.replace('T', ' ').slice(0, 19) + ' UTC';
}

function StructuredDetail({ entry }) {
  const rows = useMemo(() => {
    const items = [];
    const o = entry.outputs || {};
    const i = entry.inputs || {};
    const skip = new Set(['summary', 'title', 'headline']);
    const push = (label, value) => {
      if (value === undefined || value === null || value === '') return;
      if (Array.isArray(value) && value.length === 0) return;
      items.push({ label, value });
    };
    Object.keys(i).slice(0, 8).forEach(k => {
      if (typeof i[k] === 'string' || typeof i[k] === 'number') push(`Input · ${labelize(k)}`, i[k]);
    });
    Object.keys(o).forEach(k => {
      if (skip.has(k)) return;
      const v = o[k];
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        push(labelize(k), String(v));
      } else if (Array.isArray(v) && v.length && v.length <= 12 && v.every(x => typeof x === 'string')) {
        push(labelize(k), v.join(', '));
      } else if (Array.isArray(v)) {
        push(labelize(k), `${v.length} item${v.length === 1 ? '' : 's'}`);
      } else if (v && typeof v === 'object') {
        push(labelize(k), `${Object.keys(v).length} field${Object.keys(v).length === 1 ? '' : 's'}`);
      }
    });
    return items;
  }, [entry]);

  const refs = entry.sourceReferences || [];

  return (
    <div className="audit-detail">
      {rows.length > 0 && (
        <dl className="audit-detail-grid">
          {rows.map((r, idx) => (
            <React.Fragment key={idx}>
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      {refs.length > 0 && (
        <div className="audit-refs">
          <div className="audit-refs-head">Source references ({refs.length})</div>
          <ul className="audit-refs-list">
            {refs.slice(0, 8).map((r, idx) => (
              <li key={idx}>
                {r.url
                  ? <a href={r.url} target="_blank" rel="noreferrer">{r.title || r.url}</a>
                  : <span>{r.title || r.id || 'reference'}</span>}
                {r.publishedAt && <span className="caption"> · {r.publishedAt.slice(0, 10)}</span>}
              </li>
            ))}
            {refs.length > 8 && <li className="caption">…and {refs.length - 8} more.</li>}
          </ul>
        </div>
      )}
      {rows.length === 0 && refs.length === 0 && (
        <div className="caption">No structured detail recorded for this entry.</div>
      )}
    </div>
  );
}

export default function AuditTrail() {
  useTitle('Activity log');
  const { currentId } = useWorkspace();
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [type, setType] = useState('all');
  const [expanded, setExpanded] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!currentId) return;
    setError(null);
    setLoading(true);
    const params = type === 'all' ? {} : { type };
    wsApi.audit(currentId, { ...params, limit: 200 })
      .then(r => { setEntries(r.entries || []); setTotal(r.total || 0); })
      .catch(err => setError(err.response?.data?.message || err.response?.data?.error || err.message))
      .finally(() => setLoading(false));
  }, [currentId, type]);

  return (
    <div>
      <h1>Activity log</h1>
      <p className="caption">
        Every classification, engine run, briefing and user action recorded for this workspace.
        Showing the most recent {Math.min(200, total)} of {total}.
      </p>

      {error && (
        <div className="banner-warn" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <AlertCircle size={14} /> Couldn’t load activity log: {error}
        </div>
      )}

      <div className="filter-bar" role="tablist">
        {TYPE_OPTIONS.map(t => (
          <button
            key={t.id}
            type="button"
            className={`chip ${type === t.id ? 'active' : ''}`}
            onClick={() => setType(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="audit-list">
        {loading && entries.length === 0 && (
          <div className="caption" style={{ padding: 16 }}>Loading activity…</div>
        )}
        {entries.map(e => {
          const open = expanded === e.id;
          return (
            <div key={e.id} className="audit-entry" style={{ alignItems: 'flex-start' }}>
              <button
                type="button"
                className="audit-expander"
                onClick={() => setExpanded(open ? null : e.id)}
                aria-expanded={open}
                aria-label={open ? 'Collapse' : 'Expand'}
              >
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <span className="audit-time">{fmtTime(e.timestamp)}</span>
              <span className="audit-type">{TYPE_LABEL[e.type] || labelize(e.type)}</span>
              <span className="audit-payload">
                <div className="audit-title">{titleFromEntry(e)}</div>
                <div className="caption" style={{ marginTop: 2 }}>by {e.actor || 'system'}</div>
                {open && <StructuredDetail entry={e} />}
              </span>
            </div>
          );
        })}
        {!loading && entries.length === 0 && !error && (
          <div className="empty-state">No activity recorded for this filter yet.</div>
        )}
      </div>
    </div>
  );
}
