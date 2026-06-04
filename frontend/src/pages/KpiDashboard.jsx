import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Info, X, BookOpen } from 'lucide-react';
import { useWorkspace } from '../components/WorkspaceContext.jsx';
import { kpi as kpiApi } from '../api.js';
import { useTitle } from '../lib/useTitle.js';
import WalletGapMethodologyModal from '../components/WalletGapMethodologyModal.jsx';

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
  },
  'Estimated spend': {
    definition: 'Estimated total external legal spend across the client portfolio. The denominator the firm is competing for.',
    formula:    'Σ (client.revenue × sector_benchmark_ratio × size_adjustment) across all clients with public-finance data',
    note:       'Sector ratios anchored to industry benchmarks (Acritas / CounselLink / AmLaw 200). Range 6 bp (technology) to 20 bp (pharma) of revenue. Size adjustment ranges 0.6× (small) to 1.2× (mega-cap).'
  },
  'Wallet share': {
    definition: 'Proportion of estimated total legal spend that the firm currently captures across the portfolio.',
    formula:    'Σ feesBilled (trailing 12 months) / Σ estimatedSpend',
    note:       'Mid-tier UK firms typically run 1–5% wallet share across mega-cap multinationals. Single-relationship "anchor" clients can run 20%+.'
  },
  'Addressable gap': {
    definition: 'Estimated total spend minus what the firm has billed — the upside left on the table across the portfolio.',
    formula:    'Σ estimatedSpend − Σ feesBilled (trailing 12 months)',
    note:       'This is the deck\'s headline figure. Combine with the Wallet-gap leaderboard to see which clients carry the most addressable upside.'
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
  if (compact && Math.abs(amount) >= 1e9) return `£${(amount / 1e9).toFixed(1)}bn`;
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
    { label: 'Fees billed',     value: fmtGbp(firm.feesBilled,     { compact: true }) },
    { label: 'Worked value',    value: fmtGbp(firm.workedValue,    { compact: true }) },
    { label: 'Write-off',       value: fmtPct(firm.writeOffPct) },
    { label: 'Realisation',     value: fmtPct(firm.realisationPct) },
    { label: 'Avg margin',      value: fmtPct(firm.marginPct) },
    { label: 'Avg DSO',         value: fmtDays(firm.avgDso) },
    { label: 'Active matters',  value: firm.activeCount },
    { label: 'Closed matters',  value: firm.closedCount },
    // Phase 3 — wallet-gap tiles. These three together tell the deck's
    // slide-6 story at firm level: how much the portfolio spends, what
    // share we have, what's left on the table.
    { label: 'Estimated spend', value: firm.estimatedSpendGbp != null ? fmtGbp(firm.estimatedSpendGbp, { compact: true }) : '—' },
    { label: 'Wallet share',    value: firm.walletSharePct    != null ? fmtPct(firm.walletSharePct) : '—' },
    { label: 'Addressable gap', value: firm.walletGapGbp      != null ? fmtGbp(firm.walletGapGbp, { compact: true }) : '—' }
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

// Column-header info popover. Same shape as the Matters table HeaderInfo
// pattern: click toggles, outside-click closes, only one open at a time.
// Used on the four numeric leaderboard columns so a partner reading the
// table can drill into what each number means without leaving the page.
function LeaderboardColumnInfo({ label, info, isOpen, onToggle }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!isOpen) return;
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onToggle(null);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [isOpen, onToggle]);
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
      <span>{label}</span>
      <button
        type="button"
        className="kpi-tile-info"
        onClick={(e) => { e.stopPropagation(); onToggle(isOpen ? null : label); }}
        aria-label={`What is ${label}?`}
        aria-expanded={isOpen}
      >
        <Info size={11} />
      </button>
      {isOpen && (
        <div
          className="kpi-tile-popover"
          role="tooltip"
          style={{ left: 0, right: 'auto', width: 340, textAlign: 'left', whiteSpace: 'normal', textTransform: 'none', letterSpacing: 'normal', fontWeight: 400 }}
        >
          <button type="button" className="kpi-tile-popover-close" onClick={() => onToggle(null)} aria-label="Close">
            <X size={12} />
          </button>
          <div className="kpi-tile-popover-section">
            <div className="kpi-tile-popover-label">What it is</div>
            <p className="kpi-tile-popover-text">{info.definition}</p>
          </div>
          <div className="kpi-tile-popover-section">
            <div className="kpi-tile-popover-label">How it's calculated</div>
            <div className="kpi-tile-popover-formula">{info.formula}</div>
          </div>
          {info.note && (
            <div className="kpi-tile-popover-section">
              <div className="kpi-tile-popover-label">Note</div>
              <p className="kpi-tile-popover-text">{info.note}</p>
            </div>
          )}
        </div>
      )}
    </span>
  );
}

// Definitions for the four numeric columns on the wallet-gap
// leaderboard. Same vocabulary the partner already sees on the firm-
// level TILE_DEFINITIONS so the cross-page reading is consistent.
const LEADERBOARD_COL_INFO = {
  'Internal billed': {
    definition: 'Fees the firm billed THIS client over the trailing 12 months, FX-normalised to GBP.',
    formula: 'Σ feesBilled across this client\'s matters in the last 365 days',
    note: 'Active matters always count; closed matters count if endDate is within 365 days.'
  },
  'Est. total spend': {
    definition: 'Estimated total external legal spend this client pays across all firms in a year — the denominator the firm is competing for.',
    formula: 'revenue × sector_benchmark_ratio × size_adjustment',
    note: 'Heuristic anchored to industry benchmarks (Acritas / CounselLink / AmLaw 200). Sector ratios range 6 bp (technology) to 20 bp (pharma); size multiplier ranges 0.6× (small) to 1.2× (mega).'
  },
  'Wallet share': {
    definition: 'Proportion of this client\'s total external legal spend that the firm currently captures.',
    formula: 'internal_billed / estimated_total',
    note: 'Mid-tier UK firms typically run 1–5% across mega-cap multinationals. Anchor clients can reach 20%+.'
  },
  'Addressable gap': {
    definition: 'Estimated total minus what the firm has billed — upside left on the table for this client.',
    formula: 'estimated_total − internal_billed',
    note: 'A wallet-gap opportunity is emitted only when gap > £500k AND wallet share < 60%.'
  }
};

// Wallet-gap leaderboard — one row per client with public-finance data,
// sorted by gap size descending. Reads from `data.walletGapByClient`
// which kpiAggregator.js populates via computeWalletGapPortfolio.
// Anchors the deck's slide-6 walkthrough at firm level: who carries the
// biggest addressable upside, what share we currently hold, the
// untapped practice areas per row.
function WalletGapLeaderboard({ rows }) {
  const { currentId } = useWorkspace();
  const [expanded, setExpanded] = useState(false);
  const [openCol, setOpenCol] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const visible = expanded ? rows : rows.slice(0, 6);
  return (
    <>
      <section className="kpi-section">
        <div className="kpi-section-head">
          <div>
            <h3>Wallet-gap leaderboard</h3>
            <p className="caption" style={{ marginBottom: 4 }}>
              Estimated total legal spend, current share, and addressable gap per client. Combine with the worthiness lens before any pursuit decision — biggest gap ≠ best target.
            </p>
            <button
              type="button"
              className="btn-link"
              onClick={() => setShowModal(true)}
              style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <BookOpen size={12} /> How is this computed?
            </button>
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
              <th>Client</th>
              <th className="num">
                <LeaderboardColumnInfo label="Internal billed" info={LEADERBOARD_COL_INFO['Internal billed']} isOpen={openCol === 'Internal billed'} onToggle={setOpenCol} />
              </th>
              <th className="num">
                <LeaderboardColumnInfo label="Est. total spend" info={LEADERBOARD_COL_INFO['Est. total spend']} isOpen={openCol === 'Est. total spend'} onToggle={setOpenCol} />
              </th>
              <th className="metric">
                <LeaderboardColumnInfo label="Wallet share" info={LEADERBOARD_COL_INFO['Wallet share']} isOpen={openCol === 'Wallet share'} onToggle={setOpenCol} />
              </th>
              <th className="num">
                <LeaderboardColumnInfo label="Addressable gap" info={LEADERBOARD_COL_INFO['Addressable gap']} isOpen={openCol === 'Addressable gap'} onToggle={setOpenCol} />
              </th>
              <th>Top untapped practices</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(r => (
              <tr key={r.clientId}>
                <td>
                  {currentId
                    ? <Link to={`/workspaces/${currentId}/clients/${r.clientId}`}>{r.clientName}</Link>
                    : r.clientName}
                </td>
                <td className="num">{fmtGbp(r.internalBilledGbp, { compact: true })}</td>
                <td className="num">{fmtGbp(r.estimatedTotalGbp, { compact: true })}</td>
                <td className="metric"><MetricBar value={r.walletSharePct} /></td>
                <td className="num" style={{ fontWeight: 600 }}>{fmtGbp(r.gapGbp, { compact: true })}</td>
                <td style={{ fontSize: 12, color: 'var(--octave-text-muted)' }}>
                  {r.gapByPracticeArea && r.gapByPracticeArea.length
                    ? r.gapByPracticeArea.slice(0, 3).map(prettyPractice).join(', ')
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {showModal && <WalletGapMethodologyModal onClose={() => setShowModal(false)} />}
    </>
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

          {/* Phase 3 — Wallet-gap leaderboard. Reads the per-client
              wallet-gap rows from kpiAggregator and renders them as a
              ranked list. Each row links to the client's detail page
              where the partner gets the full breakdown + methodology. */}
          {Array.isArray(data.walletGapByClient) && data.walletGapByClient.length > 0 && (
            <WalletGapLeaderboard rows={data.walletGapByClient} />
          )}

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
