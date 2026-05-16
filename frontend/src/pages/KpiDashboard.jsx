import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Info, X } from 'lucide-react';
import { useWorkspace } from '../components/WorkspaceContext.jsx';
import { kpi as kpiApi } from '../api.js';
import { useTitle } from '../lib/useTitle.js';

// Partner-readable definitions for each KPI tile. The info icon on each tile
// opens a popover with the definition, the calculation formula (in plain
// words + symbols), and a one-line interpretation note. Mirrors how the
// backend lib/kpiAggregator.js actually computes each metric — keep in sync
// if formulas change there.
const TILE_DEFINITIONS = {
  'Fees billed': {
    definition: 'Total amount invoiced to clients across all matters in the current view.',
    formula:    'Σ feesBilled  (across all matters, normalised to GBP at the FX date shown)',
    note:       'Includes both active and closed matters. For active matters this is what\'s been billed to date.'
  },
  'Worked value': {
    definition: 'Standard-rate value of the work performed — what fees would have been with no write-offs or discounts.',
    formula:    'Σ workedValue  (across all matters, normalised to GBP)',
    note:       'Always ≥ Fees billed. The gap between the two is the firm\'s write-off.'
  },
  'Write-off': {
    definition: 'Percentage of standard-rate value reduced before invoicing — fees the firm worked for but didn\'t charge.',
    formula:    '(Σ workedValue − Σ feesBilled) / Σ workedValue',
    note:       '9% means £9 of every £100 of standard-rate work was forgiven, capped, or discounted. Mid-tier UK firms typically run 8-12%.'
  },
  'Realisation': {
    definition: 'Percentage of billed fees actually collected from clients.',
    formula:    'Σ feesCollected / Σ feesBilled   (closed matters only)',
    note:       'Active matters are excluded because their collections are still partial. 85-95% is healthy for a mid-tier UK firm.'
  },
  'Avg margin': {
    definition: 'Gross profit margin on billed fees — how much of every £ billed is left after direct cost.',
    formula:    '(Σ feesBilled − Σ directCost) / Σ feesBilled',
    note:       'Direct cost = fee-earner time at internal rates + matter-specific disbursements. Firm overhead is NOT deducted; this is a gross-margin proxy, not net.'
  },
  'Avg DSO': {
    definition: 'Days Sales Outstanding — the average number of days between invoice date and the client paying.',
    formula:    'Mean of paymentDays  (closed matters only)',
    note:       '<60 days is healthy; 60-90 is acceptable; >90 days suggests collection issues. Lower is always better.'
  },
  'Active matters': {
    definition: 'Matters currently in flight — work that\'s open, not yet closed.',
    formula:    'Count where status ∈ { active, in_progress, open }',
    note:       'Excluded from realisation + DSO calculations because they\'re still mid-billing.'
  },
  'Closed matters': {
    definition: 'Matters with any closed status (won, lost, or simply closed).',
    formula:    'Count where status ∈ { closed, closed_won, closed_lost }',
    note:       'Population used as the denominator for realisation and DSO calculations.'
  }
};

const RANGES = [
  { id: 'all',    label: 'All' },
  { id: '12m',    label: 'Last 12 months' },
  { id: '6m',     label: 'Last 6 months' },
  { id: 'active', label: 'Active only' }
];

// Practice-area display names. The taxonomy file labels services but not
// practice areas — and the snake_case ID rendered raw reads badly because of
// embedded acronyms (ma, ip, eu).
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

const SECTOR_LABEL = {
  oil_gas:           'Oil & Gas',
  banking:           'Banking',
  shipping:          'Shipping',
  automotive:        'Automotive',
  semiconductors:    'Semiconductors',
  defense_aerospace: 'Defense & Aerospace',
  telecoms:          'Telecoms',
  technology:        'Technology',
  pharma:            'Pharma'
};

function prettyPractice(p) { return PRACTICE_LABEL[p] || p.replace(/_/g, ' '); }
function prettySector(s)   { return SECTOR_LABEL[s]   || (s || '—').replace(/_/g, ' '); }

function fmtGbp(amount, { compact = false } = {}) {
  if (amount == null) return '—';
  if (compact && Math.abs(amount) >= 1e6) return `£${(amount / 1e6).toFixed(1)}M`;
  if (compact && Math.abs(amount) >= 1e3) return `£${(amount / 1e3).toFixed(0)}k`;
  return `£${Math.round(amount).toLocaleString()}`;
}

function fmtPct(value) {
  if (value == null) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function fmtDays(value) {
  if (value == null) return '—';
  return `${Math.round(value)} days`;
}

// Inline bar — gives the partner an at-a-glance read on a percentage metric.
// All bars share the same axis (0-100%) so practice-by-practice comparisons
// are honest.
function MetricBar({ value, hint }) {
  if (value == null) return <span className="kpi-bar-empty">—</span>;
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div className="kpi-bar" title={hint || `${pct.toFixed(1)}%`}>
      <div className="kpi-bar-fill" style={{ width: `${pct}%` }} />
      <span className="kpi-bar-label">{pct.toFixed(1)}%</span>
    </div>
  );
}

function KpiTile({ label, value, definition, isOpen, onToggle }) {
  const ref = useRef(null);
  // Close on outside click — the popover is anchored to the tile, so anything
  // outside the tile is "outside" the popover for the partner.
  useEffect(() => {
    if (!isOpen) return;
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onToggle(null);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [isOpen, onToggle]);

  return (
    <div className="kpi-tile" ref={ref}>
      <div className="kpi-tile-head">
        <div className="label">{label}</div>
        {definition && (
          <button
            type="button"
            className="kpi-tile-info"
            onClick={() => onToggle(isOpen ? null : label)}
            aria-label={`How is ${label} calculated?`}
            aria-expanded={isOpen}
          >
            <Info size={13} />
          </button>
        )}
      </div>
      <div className="value">{value}</div>
      {isOpen && definition && (
        <div className="kpi-tile-popover" role="tooltip">
          <button
            type="button"
            className="kpi-tile-popover-close"
            onClick={() => onToggle(null)}
            aria-label="Close"
          >
            <X size={12} />
          </button>
          <div className="kpi-tile-popover-section">
            <div className="kpi-tile-popover-label">What it is</div>
            <p className="kpi-tile-popover-text">{definition.definition}</p>
          </div>
          <div className="kpi-tile-popover-section">
            <div className="kpi-tile-popover-label">How it's calculated</div>
            <div className="kpi-tile-popover-formula">{definition.formula}</div>
          </div>
          {definition.note && (
            <div className="kpi-tile-popover-section">
              <div className="kpi-tile-popover-label">Note</div>
              <p className="kpi-tile-popover-text">{definition.note}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FirmTiles({ firm }) {
  // One open-tile id at a time — clicking another tile's info closes the
  // current one. Stored at this level so all tiles can read/update it.
  const [openTile, setOpenTile] = useState(null);
  if (!firm) return null;
  const tiles = [
    { label: 'Fees billed',   value: fmtGbp(firm.feesBilled,   { compact: true }) },
    { label: 'Worked value',  value: fmtGbp(firm.workedValue,  { compact: true }) },
    { label: 'Write-off',     value: fmtPct(firm.writeOffPct) },
    { label: 'Realisation',   value: fmtPct(firm.realisationPct) },
    { label: 'Avg margin',    value: fmtPct(firm.marginPct) },
    { label: 'Avg DSO',       value: fmtDays(firm.avgDso) },
    { label: 'Active matters',value: firm.activeCount },
    { label: 'Closed matters',value: firm.closedCount }
  ];
  return (
    <div className="kpi-tile-grid">
      {tiles.map(t => (
        <KpiTile
          key={t.label}
          label={t.label}
          value={t.value}
          definition={TILE_DEFINITIONS[t.label]}
          isOpen={openTile === t.label}
          onToggle={setOpenTile}
        />
      ))}
    </div>
  );
}

function BreakdownTable({ title, caption, rows, firstColLabel, firstColRender }) {
  const [expanded, setExpanded] = useState(false);
  if (!rows || !rows.length) return null;
  const visible = expanded ? rows : rows.slice(0, 6);
  return (
    <section className="kpi-section">
      <div className="kpi-section-head">
        <div>
          <h3>{title}</h3>
          {caption && <p className="caption">{caption}</p>}
        </div>
        {rows.length > 6 && (
          <button className="btn btn-secondary kpi-section-toggle" onClick={() => setExpanded(e => !e)}>
            {expanded ? 'Show top 6' : `Show all ${rows.length}`}
          </button>
        )}
      </div>
      <table className="kpi-table">
        <thead>
          <tr>
            <th>{firstColLabel}</th>
            <th className="num">Matters</th>
            <th className="num">Fees billed</th>
            <th className="metric">Write-off</th>
            <th className="metric">Realisation</th>
            <th className="metric">Margin</th>
            <th className="num">Avg DSO</th>
          </tr>
        </thead>
        <tbody>
          {visible.map(r => (
            <tr key={r.key}>
              <td>{firstColRender(r)}</td>
              <td className="num">{r.count}</td>
              <td className="num">{fmtGbp(r.feesBilled, { compact: true })}</td>
              <td className="metric"><MetricBar value={r.writeOffPct} /></td>
              <td className="metric"><MetricBar value={r.realisationPct} /></td>
              <td className="metric"><MetricBar value={r.marginPct} /></td>
              <td className="num">{fmtDays(r.avgDso)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function KpiDashboard() {
  useTitle('KPI dashboard');
  const { currentId } = useWorkspace();
  const [range, setRange] = useState('all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    kpiApi.summary(currentId, { range })
      .then(r => { if (!cancelled) setData(r); })
      .catch(err => { if (!cancelled) setError(err.response?.data?.error || err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentId, range]);

  const subhead = useMemo(() => {
    const r = RANGES.find(x => x.id === range);
    const fx = data?.fxAsOf ? ` · FX ${data.fxAsOf}` : '';
    return `Firm-wide commercial health · ${r?.label || 'All'} · All figures in GBP${fx}`;
  }, [range, data]);

  return (
    <div className="kpi-page">
      <div className="kpi-head">
        <h1>KPI Dashboard</h1>
        <p className="caption">{subhead}</p>
      </div>

      <div className="filter-bar">
        {RANGES.map(r => (
          <span
            key={r.id}
            className={`chip ${range === r.id ? 'active' : ''}`}
            onClick={() => setRange(r.id)}
            role="button"
          >
            {r.label}
          </span>
        ))}
      </div>

      {error && <div className="banner-warn">Failed to load KPIs: {error}</div>}
      {loading && !data && <div className="empty-state">Loading…</div>}

      {data && (
        <>
          <FirmTiles firm={data.firm} />

          <BreakdownTable
            title="By practice area"
            caption="Where the firm earns. Litigation and M&A are the workhorses; M&A and tax run the cleanest economics."
            rows={data.byPractice}
            firstColLabel="Practice"
            firstColRender={r => prettyPractice(r.key)}
          />

          <BreakdownTable
            title="By partner"
            caption="Top fee-generators in the current view. Useful for compensation discussions and capacity planning."
            rows={data.byPartner}
            firstColLabel="Partner"
            firstColRender={r => r.name}
          />

          <BreakdownTable
            title="By sector"
            caption="Where the work originates by client industry. Useful for portfolio-level concentration risk reads."
            rows={data.bySector}
            firstColLabel="Sector"
            firstColRender={r => prettySector(r.key)}
          />

          <BreakdownTable
            title="Top clients by revenue"
            caption="Top fee-paying clients in the current view. Combine with the worthiness lens before any pursuit decision."
            rows={data.byClient}
            firstColLabel="Client"
            firstColRender={r => r.name}
          />
        </>
      )}
    </div>
  );
}
