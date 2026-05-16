import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, ExternalLink, AlertCircle } from 'lucide-react';
import { useWorkspace } from '../components/WorkspaceContext.jsx';
import { workspaces as wsApi } from '../api.js';
import { useTitle } from '../lib/useTitle.js';

export default function ClientDetail() {
  const { currentId } = useWorkspace();
  const { cid } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  useTitle(data?.entity?.legalName || 'Client');

  useEffect(() => {
    if (!currentId || !cid) return;
    let cancelled = false;
    setError(null);
    setData(null);
    wsApi.client(currentId, cid)
      .then(r => { if (!cancelled) setData(r); })
      .catch(err => {
        if (cancelled) return;
        const status = err.response?.status;
        if (status === 404) setError({ kind: 'not_found' });
        else setError({ kind: 'load_failed', message: err.response?.data?.message || err.message });
      });
    return () => { cancelled = true; };
  }, [currentId, cid, reloadKey]);

  if (error) {
    return (
      <div>
        <div style={{ marginBottom: 16 }}>
          <Link to={`/workspaces/${currentId}/clients`} className="btn btn-secondary">
            <ChevronLeft size={16} /> Back to list
          </Link>
        </div>
        <div className="banner-warn" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertCircle size={16} />
          <div style={{ flex: 1 }}>
            {error.kind === 'not_found'
              ? <span>This client isn’t in the current workspace. It may have been removed in a recent re-bake.</span>
              : <span>We couldn’t load this client. {error.message ? `Reason: ${error.message}.` : ''}</span>}
          </div>
          {error.kind !== 'not_found' && (
            <button className="btn btn-secondary" onClick={() => setReloadKey(k => k + 1)}>Retry</button>
          )}
        </div>
      </div>
    );
  }
  if (!data) return <div className="caption" style={{ padding: 24 }}>Loading client…</div>;
  const { entity, matters, signals, opportunities } = data;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Link to={`/workspaces/${currentId}/clients`} className="btn btn-secondary">
          <ChevronLeft size={16} /> Back to list
        </Link>
      </div>
      <h1>{entity.legalName}</h1>
      <p className="caption">{entity.sector} · {entity.hqJurisdiction} · {entity.size} · maturity: {entity.relationshipMaturity || '—'}</p>

      <div className="entity-summary">
        <div className="kpi-tile"><div className="label">Matters</div><div className="value">{matters?.length || 0}</div></div>
        <div className="kpi-tile"><div className="label">Signals</div><div className="value">{signals?.length || 0}</div></div>
        <div className="kpi-tile"><div className="label">Opportunities</div><div className="value">{opportunities?.length || 0}</div></div>
        <div className="kpi-tile"><div className="label">Aliases</div><div className="value" style={{ fontSize: 18 }}>{(entity.knownAliases || []).length}</div></div>
      </div>

      <div className="split-2col">
        <div>
          <h3 style={{ margin: '16px 0 12px' }}>Recent signals</h3>
          {(signals || []).slice(0, 12).map(s => (
            <div key={s.id} className="signal-row">
              <span className="src">[{s.source}]</span>
              <span><a href={s.sourceUrl} target="_blank" rel="noreferrer">{s.title}</a></span>
              <span className="caption">{s.publishedAt?.slice(0, 10)}</span>
              <span className="caption">{s.isLegallySignificant ? '✓ legal' : '—'}</span>
            </div>
          ))}
          {(signals || []).length === 0 && <div className="empty-state">No recent signals.</div>}

          <h3 style={{ margin: '24px 0 12px' }}>Matter history</h3>
          {(matters || []).map(m => (
            <div key={m.id} className="matter-row">
              <span className="matter-id">{m.id}</span>
              <span>{m.matterTitle}</span>
              <span className="caption">{m.leadPartner}</span>
              <span className="caption">{m.status}</span>
            </div>
          ))}
        </div>
        <div>
          <h3 style={{ margin: '16px 0 12px' }}>Open opportunities</h3>
          {(opportunities || []).map(o => (
            <div key={o.id} style={{ padding: 12, border: '1px solid var(--octave-n300)', borderRadius: 8, marginBottom: 8, fontSize: 13 }}>
              <Link to={`/workspaces/${currentId}/opportunities/${o.id}`} style={{ fontWeight: 600 }}>{o.suggestedService?.replace(/_/g, ' ')}</Link>
              <div className="caption">{o.basis?.summary?.slice(0, 120)}</div>
            </div>
          ))}
          {(opportunities || []).length === 0 && <div className="empty-state">No open opportunities.</div>}

          {entity.publicEntityUrl && (
            <p style={{ marginTop: 16 }}>
              <a href={entity.publicEntityUrl} target="_blank" rel="noreferrer">{entity.publicEntityUrl} <ExternalLink size={12} /></a>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
