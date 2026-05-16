import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useWorkspace } from '../components/WorkspaceContext.jsx';
import { workspaces as wsApi } from '../api.js';
import { friendlyError } from '../lib/errorMessages.js';
import { labelize, prettyStatus } from '../lib/labels.js';
import { useTitle } from '../lib/useTitle.js';

const STATUS_FILTERS = [
  { id: 'all',         label: 'All' },
  { id: 'open',        label: 'Open' },
  { id: 'closed_won',  label: 'Closed — won' },
  { id: 'closed_lost', label: 'Closed — lost' },
  { id: 'closed',      label: 'Closed' }
];

export default function Matters() {
  useTitle('Matters');
  const { currentId } = useWorkspace();
  const [matters, setMatters] = useState([]);
  const [entityMap, setEntityMap] = useState(new Map());
  const [filter, setFilter] = useState('all');
  const [partnerFilter, setPartnerFilter] = useState('all');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    setError(null);
    setLoading(true);
    Promise.all([
      wsApi.matters(currentId),
      wsApi.clients(currentId)
    ])
      .then(([m, c]) => {
        if (cancelled) return;
        setMatters(m || []);
        const map = new Map();
        for (const e of [...(c.clients || []), ...(c.prospects || [])]) {
          if (e?.id) map.set(e.id, e);
        }
        setEntityMap(map);
      })
      .catch(err => { if (!cancelled) setError(friendlyError(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentId]);

  const filtered = useMemo(() => matters.filter(m => {
    if (filter !== 'all' && m.status !== filter) return false;
    if (partnerFilter !== 'all' && (m.leadPartner || '') !== partnerFilter) return false;
    return true;
  }), [matters, filter, partnerFilter]);

  const partners = useMemo(() => {
    const s = new Set();
    matters.forEach(m => m.leadPartner && s.add(m.leadPartner));
    return [...s].sort();
  }, [matters]);

  const totalFees = useMemo(
    () => filtered.reduce((acc, m) => acc + (Number(m.feesBilled) || 0), 0),
    [filtered]
  );

  return (
    <div>
      <h1>Matters</h1>
      <p className="caption">
        Matter history — used as cross-sell context and credentialing for new opportunities.
        Showing {filtered.length} of {matters.length}.
      </p>

      {error && <div className="banner-warn" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="filter-bar" role="tablist">
        {STATUS_FILTERS.map(s => (
          <button
            key={s.id}
            type="button"
            className={`chip ${filter === s.id ? 'active' : ''}`}
            onClick={() => setFilter(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {partners.length > 1 && (
        <div className="filter-bar" style={{ marginTop: 4 }}>
          <span className="caption" style={{ marginRight: 4 }}>Partner:</span>
          <button
            type="button"
            className={`chip ${partnerFilter === 'all' ? 'active' : ''}`}
            onClick={() => setPartnerFilter('all')}
          >All</button>
          {partners.map(p => (
            <button
              key={p}
              type="button"
              className={`chip ${partnerFilter === p ? 'active' : ''}`}
              onClick={() => setPartnerFilter(p)}
            >{p}</button>
          ))}
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--octave-n300)' }}>
            <th style={{ textAlign: 'left', padding: '8px 8px 8px 0' }}>ID</th>
            <th style={{ textAlign: 'left', padding: '8px 8px' }}>Client</th>
            <th style={{ textAlign: 'left', padding: '8px 8px' }}>Title</th>
            <th style={{ textAlign: 'left', padding: '8px 8px' }}>Partner</th>
            <th style={{ textAlign: 'right', padding: '8px 8px' }}>Fees billed</th>
            <th style={{ textAlign: 'left', padding: '8px 0 8px 8px' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(m => {
            const client = entityMap.get(m.client);
            const clientName = client?.legalName || m.clientLegalName || m.client || '—';
            const fees = Number(m.feesBilled);
            const cur = (m.currency || 'GBP').toUpperCase();
            return (
              <tr key={m.id} style={{ borderBottom: '1px solid var(--octave-n100)' }}>
                <td style={{ padding: '10px 8px 10px 0', fontVariantNumeric: 'tabular-nums' }}>{m.id}</td>
                <td style={{ padding: '10px 8px' }}>
                  {client ? (
                    <Link to={`/workspaces/${currentId}/clients/${client.id}`}>{clientName}</Link>
                  ) : clientName}
                </td>
                <td style={{ padding: '10px 8px' }}>{m.matterTitle}</td>
                <td style={{ padding: '10px 8px' }}>{m.leadPartner || '—'}</td>
                <td style={{ padding: '10px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {Number.isFinite(fees) && fees > 0 ? `${cur} ${fees.toLocaleString()}` : '—'}
                </td>
                <td style={{ padding: '10px 0 10px 8px' }}>{prettyStatus(m.status) || labelize(m.status) || '—'}</td>
              </tr>
            );
          })}
          {!loading && filtered.length === 0 && (
            <tr>
              <td colSpan={6}>
                <div className="empty-state" style={{ marginTop: 16 }}>
                  No matters match the current filters.
                  {filter !== 'all' || partnerFilter !== 'all' ? (
                    <button
                      className="btn-link"
                      onClick={() => { setFilter('all'); setPartnerFilter('all'); }}
                      style={{ marginLeft: 8 }}
                    >Clear filters</button>
                  ) : null}
                </div>
              </td>
            </tr>
          )}
        </tbody>
        {filtered.length > 0 && (
          <tfoot>
            <tr style={{ borderTop: '1px solid var(--octave-n300)' }}>
              <td colSpan={4} style={{ padding: '10px 8px 10px 0', fontWeight: 500 }}>
                {filtered.length} matter{filtered.length === 1 ? '' : 's'}
              </td>
              <td style={{ padding: '10px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                {totalFees > 0 ? `GBP ${totalFees.toLocaleString()}` : '—'}
              </td>
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
