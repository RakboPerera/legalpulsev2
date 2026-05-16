import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, TrendingDown, Clock, ChevronUp, ChevronDown } from 'lucide-react';
import { useWorkspace } from '../components/WorkspaceContext.jsx';
import { insights as insightsApi } from '../api.js';
import { useTitle } from '../lib/useTitle.js';

const PRACTICE_LABEL = {
  corporate_ma:             'Corporate M&A',
  banking_finance:          'Banking & Finance',
  litigation_disputes:      'Litigation & Disputes',
  regulatory_compliance:    'Regulatory & Compliance',
  energy_natural_resources: 'Energy & Natural Resources',
  ip_technology:            'IP & Technology',
  real_estate:              'Real Estate',
  restructuring_insolvency: 'Restructuring & Insolvency',
  tax:                      'Tax',
  employment:               'Employment',
  sanctions_trade:          'Sanctions & Trade'
};
const prettyPractice = p => PRACTICE_LABEL[p] || (p || '').replace(/_/g, ' ');

function fmtGbp(n) {
  if (n == null) return '—';
  if (Math.abs(n) >= 1e6) return `£${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `£${(n / 1e3).toFixed(0)}k`;
  return `£${Math.round(n).toLocaleString()}`;
}
function fmtPct(value, { signed = false } = {}) {
  if (value == null) return '—';
  const pct = value * 100;
  return signed
    ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
    : `${pct.toFixed(1)}%`;
}

// Generic sortable table. Each column declares { key, label, render, sortValue,
// align }. Header click toggles direction; clicking a different column resets
// to descending (or ascending for text columns).
function SortableTable({ columns, rows, defaultSort, emptyText }) {
  const [sortKey, setSortKey] = useState(defaultSort);
  const [sortDir, setSortDir] = useState('desc');
  const sorted = useMemo(() => {
    const col = columns.find(c => c.key === sortKey);
    if (!col) return rows;
    const arr = rows.slice();
    arr.sort((a, b) => {
      const va = col.sortValue(a);
      const vb = col.sortValue(b);
      if (va === vb) return 0;
      const cmp = (va > vb) ? 1 : -1;
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return arr;
  }, [columns, rows, sortKey, sortDir]);

  function onHeaderClick(key) {
    if (key === sortKey) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      const col = columns.find(c => c.key === key);
      setSortDir(col?.defaultDir || 'desc');
    }
  }

  if (!rows.length) return <div className="empty-state">{emptyText}</div>;

  return (
    <table className="kpi-table insights-table">
      <thead>
        <tr>
          {columns.map(c => (
            <th
              key={c.key}
              className={`${c.align === 'right' ? 'num' : ''} ${c.sortable !== false ? 'sortable' : ''}`}
              onClick={() => c.sortable !== false && onHeaderClick(c.key)}
            >
              <span>{c.label}</span>
              {sortKey === c.key && (
                sortDir === 'desc'
                  ? <ChevronDown size={12} className="sort-arrow" />
                  : <ChevronUp size={12} className="sort-arrow" />
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map(r => (
          <tr key={r.matterId}>
            {columns.map(c => (
              <td key={c.key} className={c.align === 'right' ? 'num' : ''}>
                {c.render(r)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StatusBadge({ status }) {
  const active = status === 'active' || status === 'in_progress' || status === 'open';
  const cls = active ? 'status-pill status-pill-active' : 'status-pill status-pill-closed';
  return <span className={cls}>{(status || '').replace(/_/g, ' ')}</span>;
}

function SectionHead({ Icon, title, caption, count, threshold }) {
  return (
    <header className="insights-section-head">
      <div className="insights-section-icon"><Icon size={18} /></div>
      <div className="insights-section-text">
        <h3>{title}</h3>
        <p className="caption">{caption}</p>
      </div>
      <div className="insights-section-meta">
        <div className="insights-count">{count}</div>
        <div className="caption">{count === 1 ? 'matter' : 'matters'}</div>
        {threshold && <div className="insights-threshold caption">{threshold}</div>}
      </div>
    </header>
  );
}

export default function OperationalInsights() {
  useTitle('Operational insights');
  const { currentId } = useWorkspace();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    insightsApi.operational(currentId)
      .then(r => { if (!cancelled) setData(r); })
      .catch(err => { if (!cancelled) setError(err.response?.data?.error || err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentId]);

  // Some matters in the seed are tied to prospects (pr-*). The ClientDetail
  // route resolves either, but rendering the name plain when the id is a
  // prospect avoids the "looks-like-a-client" affordance for a target we
  // haven't actually engaged formally.
  const renderClient = r => {
    if (r.clientId && r.clientId.startsWith('c-')) {
      return <Link to={`/workspaces/${currentId}/clients/${r.clientId}`}>{r.clientName}</Link>;
    }
    return <span>{r.clientName}</span>;
  };

  const overrunCols = useMemo(() => [
    { key: 'matterTitle', label: 'Matter',     render: r => <span className="matter-title">{r.matterTitle}</span>, sortValue: r => r.matterTitle, defaultDir: 'asc' },
    { key: 'clientName',  label: 'Client',     render: renderClient, sortValue: r => r.clientName, defaultDir: 'asc' },
    { key: 'partnerName', label: 'Partner',    render: r => r.partnerName, sortValue: r => r.partnerName, defaultDir: 'asc' },
    { key: 'practiceArea',label: 'Practice',   render: r => prettyPractice(r.practiceArea), sortValue: r => prettyPractice(r.practiceArea), defaultDir: 'asc' },
    { key: 'status',      label: 'Status',     render: r => <StatusBadge status={r.status} />, sortValue: r => r.status, defaultDir: 'asc' },
    { key: 'overrunPct',  label: 'Over budget', align: 'right', render: r => <span className="exception-value-warn">{fmtPct(r.overrunPct, { signed: true })}</span>, sortValue: r => r.overrunPct },
    { key: 'overrunGbp',  label: 'Amount over', align: 'right', render: r => fmtGbp(r.overrunGbp), sortValue: r => r.overrunGbp }
  ], [currentId]);

  const unprofitableCols = useMemo(() => [
    { key: 'matterTitle', label: 'Matter',     render: r => <span className="matter-title">{r.matterTitle}</span>, sortValue: r => r.matterTitle, defaultDir: 'asc' },
    { key: 'clientName',  label: 'Client',     render: renderClient, sortValue: r => r.clientName, defaultDir: 'asc' },
    { key: 'partnerName', label: 'Partner',    render: r => r.partnerName, sortValue: r => r.partnerName, defaultDir: 'asc' },
    { key: 'practiceArea',label: 'Practice',   render: r => prettyPractice(r.practiceArea), sortValue: r => prettyPractice(r.practiceArea), defaultDir: 'asc' },
    { key: 'status',      label: 'Status',     render: r => <StatusBadge status={r.status} />, sortValue: r => r.status, defaultDir: 'asc' },
    { key: 'feesBilled',  label: 'Fees',       align: 'right', render: r => fmtGbp(r.feesBilled), sortValue: r => r.feesBilled },
    { key: 'marginPct',   label: 'Margin',     align: 'right', render: r => <span className="exception-value-warn">{fmtPct(r.marginPct)}</span>, sortValue: r => r.marginPct, defaultDir: 'asc' }
  ], [currentId]);

  const staleCols = useMemo(() => [
    { key: 'matterTitle',      label: 'Matter',  render: r => <span className="matter-title">{r.matterTitle}</span>, sortValue: r => r.matterTitle, defaultDir: 'asc' },
    { key: 'clientName',       label: 'Client',  render: renderClient, sortValue: r => r.clientName, defaultDir: 'asc' },
    { key: 'partnerName',      label: 'Partner', render: r => r.partnerName, sortValue: r => r.partnerName, defaultDir: 'asc' },
    { key: 'practiceArea',     label: 'Practice',render: r => prettyPractice(r.practiceArea), sortValue: r => prettyPractice(r.practiceArea), defaultDir: 'asc' },
    { key: 'feesBilled',       label: 'Fees billed', align: 'right', render: r => fmtGbp(r.feesBilled), sortValue: r => r.feesBilled },
    { key: 'daysSinceActivity',label: 'Days idle',   align: 'right', render: r => <span className="exception-value-warn">{r.daysSinceActivity}</span>, sortValue: r => r.daysSinceActivity }
  ], [currentId]);

  const t = data?.thresholds;

  return (
    <div className="kpi-page insights-page">
      <div className="kpi-head">
        <h1>Operational Insights</h1>
        <p className="caption">
          Exception lists for the managing partner — matters that need attention this week.
          {t && <> Thresholds: <strong>budget +{(t.budgetThreshold*100).toFixed(0)}%</strong> · <strong>margin &lt;{(t.marginThreshold*100).toFixed(0)}%</strong> · <strong>{t.staleDays}+ days idle</strong>.</>}
        </p>
      </div>

      {error && <div className="banner-warn">Failed to load insights: {error}</div>}
      {loading && !data && <div className="empty-state">Loading…</div>}

      {data && (
        <>
          <section className="kpi-section insights-section">
            <SectionHead
              Icon={AlertTriangle}
              title="Budget overruns"
              caption="Matters where billed fees exceed the agreed budget. Active rows are intervention candidates; closed rows are post-mortem material."
              count={data.counts.overruns}
              threshold={`>${(t.budgetThreshold*100).toFixed(0)}% over budget`}
            />
            <SortableTable
              columns={overrunCols}
              rows={data.overruns}
              defaultSort="overrunPct"
              emptyText="No matters exceed the budget threshold."
            />
          </section>

          <section className="kpi-section insights-section">
            <SectionHead
              Icon={TrendingDown}
              title="Unprofitable matters"
              caption="Matters running below firm-target margin. Active matters here are the urgent ones — scope, staffing, or pricing may need a conversation."
              count={data.counts.unprofitable}
              threshold={`<${(t.marginThreshold*100).toFixed(0)}% margin`}
            />
            <SortableTable
              columns={unprofitableCols}
              rows={data.unprofitable}
              defaultSort="marginPct"
              emptyText="No matters below the margin threshold."
            />
          </section>

          <section className="kpi-section insights-section">
            <SectionHead
              Icon={Clock}
              title="Stale matters"
              caption="Active matters with no recent activity. Either the work is genuinely paused — which the partner should know — or someone forgot to close them."
              count={data.counts.stale}
              threshold={`${t.staleDays}+ days idle`}
            />
            <SortableTable
              columns={staleCols}
              rows={data.stale}
              defaultSort="daysSinceActivity"
              emptyText="No active matters past the staleness threshold."
            />
          </section>
        </>
      )}
    </div>
  );
}
