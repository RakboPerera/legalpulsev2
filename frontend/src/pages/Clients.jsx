import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useWorkspace } from '../components/WorkspaceContext.jsx';
import { workspaces as wsApi } from '../api.js';
import { prettySector, labelize } from '../lib/labels.js';
import { friendlyError } from '../lib/errorMessages.js';
import { useTitle } from '../lib/useTitle.js';

export default function Clients() {
  useTitle('Clients & prospects');
  const { currentId } = useWorkspace();
  const [clients, setClients] = useState([]);
  const [prospects, setProspects] = useState([]);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!currentId) return;
    setError(null);
    wsApi.clients(currentId)
      .then(r => { setClients(r.clients || []); setProspects(r.prospects || []); })
      .catch(err => setError(friendlyError(err)));
  }, [currentId]);

  const list = filter === 'prospects' ? prospects : filter === 'clients' ? clients : [...clients, ...prospects];

  return (
    <div>
      <h1>Clients & Prospects</h1>
      {error && <div className="banner-warn" style={{ marginBottom: 12 }}>Failed to load entities: {error}</div>}
      <div className="filter-bar">
        <button type="button" className={`chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All ({clients.length + prospects.length})</button>
        <button type="button" className={`chip ${filter === 'clients' ? 'active' : ''}`} onClick={() => setFilter('clients')}>Clients ({clients.length})</button>
        <button type="button" className={`chip ${filter === 'prospects' ? 'active' : ''}`} onClick={() => setFilter('prospects')}>Prospects ({prospects.length})</button>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--octave-n300)' }}>
            <th style={{ textAlign: 'left', padding: '10px 0', fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Entity</th>
            <th style={{ textAlign: 'left', padding: '10px 0', fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Sector</th>
            <th style={{ textAlign: 'left', padding: '10px 0', fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: '0.05em', textTransform: 'uppercase' }}>HQ</th>
            <th style={{ textAlign: 'left', padding: '10px 0', fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Type</th>
            <th style={{ textAlign: 'left', padding: '10px 0', fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Maturity</th>
          </tr>
        </thead>
        <tbody>
          {list.map(e => (
            <tr key={e.id} style={{ borderBottom: '1px solid var(--octave-n100)' }}>
              <td style={{ padding: '12px 0' }}>
                <Link to={`/workspaces/${currentId}/clients/${e.id}`} style={{ fontWeight: 600 }}>{e.legalName}</Link>
                <div className="caption">{(e.knownAliases || []).slice(0, 3).join(', ')}</div>
              </td>
              <td>{prettySector(e.sector)}</td>
              <td>{e.hqJurisdiction}</td>
              <td>{e.id.startsWith('pr-') ? 'Prospect' : 'Client'}</td>
              <td>{labelize(e.relationshipMaturity) || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
