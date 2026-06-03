import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Info, X } from 'lucide-react';
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

// Click-to-open definitions for the six commercials columns. Mirrors the
// pattern on the KPI Dashboard tiles (see [KpiDashboard.jsx](src/pages/KpiDashboard.jsx))
// so the partner-readable language stays consistent across pages.
const COLUMN_INFO = {
  'Worked value': {
    definition: 'Standard-rate value of the work performed on this matter — what fees would have been at full rates before any discounts or write-offs.',
    formula:    'feesBilled / (1 − writeOff%)   (backfilled per matter from feesBilled using practice-area baselines)',
    note:       'Always ≥ Fees billed. The gap between Worked value and Fees billed is the firm\'s write-off on this matter.'
  },
  'Budget': {
    definition: 'Agreed budget for the matter at engagement.',
    formula:    'workedValue × budget_multiplier   (multiplier ∈ [0.78, 1.10], deterministic per matter)',
    note:       'The +X% indicator appears when Fees billed exceeds Budget by more than 10% — the same threshold the Operational Insights Budget overruns list applies.'
  },
  'Margin': {
    definition: 'Gross profit margin on billed fees for this matter — how much of every £ billed is left after direct cost.',
    formula:    '(feesBilled − directCost) / feesBilled',
    note:       'Direct cost = fee-earner time at internal rates + matter-specific disbursements. Firm overhead is NOT deducted; this is a gross-margin proxy. Red text when margin < 20% — the Unprofitable-matter threshold.'
  },
  'Realisation': {
    definition: 'Percentage of billed fees actually collected from the client for this matter.',
    formula:    'feesCollected / feesBilled',
    note:       'Shown as — for active matters because collections are still partial. 85–95% is healthy for a mid-tier UK firm on closed matters.'
  },
  'DSO / Idle': {
    definition: 'For closed matters: Days Sales Outstanding — the days between invoice and payment. For active matters: days since the last activity on the matter.',
    formula:    'Closed: paymentDays  ·  Active: deterministic per matter — ~22% bucketed stale (70–200 days idle), the rest 0–50 days',
    note:       '"Idle Xd" highlights red when > 60 days — the Stale-matter threshold on Operational Insights. Active matters have no paymentDays until they close.'
  },
  'Flags': {
    definition: 'Exception flags this matter triggers — the same three buckets the Operational Insights page surfaces.',
    formula:    'over budget if billed > budget × 1.10   ·   low margin if margin < 20%   ·   stale if active with > 60 days idle',
    note:       'A matter can carry multiple flags simultaneously. Dash (—) means the matter is within all three thresholds.'
  }
};

// Mirrors backend/lib/kpiAggregator.js + operationalInsights.js — keep in sync
// if those FX or thresholds change. We compute the dashboard's per-matter
// fields client-side so the table is the auditable source view for everything
// the KPI Dashboard and Operational Insights pages report.
const FX_TO_GBP = { GBP: 1.0, USD: 0.79, EUR: 0.85 };
const ACTIVE_STATUSES = new Set(['active', 'in_progress', 'open']);
const T = { budget: 0.10, margin: 0.20, stale: 60 };

function gbp(amount, currency) {
  const rate = FX_TO_GBP[currency || 'GBP'] ?? 1.0;
  return (Number(amount) || 0) * rate;
}

function fmtGbp(n) {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return `£${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `£${(n / 1e3).toFixed(0)}k`;
  return `£${Math.round(n).toLocaleString()}`;
}

function fmtPct(value, { signed = false } = {}) {
  if (value == null || !isFinite(value)) return '—';
  const pct = value * 100;
  return signed
    ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
    : `${pct.toFixed(1)}%`;
}

// FNV-1a 32-bit — byte-for-byte port of backend/lib/operationalInsights.js so
// the active-matter staleness classification agrees with the Operational
// Insights page.
function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function hash01(id, metric) {
  return hash32(`${id}:${metric}`) / 0xFFFFFFFF;
}

function daysSinceLastActivity(matter, nowMs = Date.now()) {
  if (matter.endDate) {
    const ts = new Date(matter.endDate).getTime();
    if (!isNaN(ts)) return Math.max(0, Math.round((nowMs - ts) / 86400000));
  }
  if (!ACTIVE_STATUSES.has(matter.status)) return null;
  const isStale = hash01(matter.id, 'stale') < 0.22;
  if (isStale) return 70 + Math.floor(hash01(matter.id, 'stale_days') * 130);
  return Math.floor(hash01(matter.id, 'recent_days') * 50);
}

function deriveMetrics(m) {
  const fb = gbp(m.feesBilled,    m.currency);
  const wv = gbp(m.workedValue,   m.currency);
  const bg = gbp(m.budget,        m.currency);
  const dc = gbp(m.directCost,    m.currency);
  const fc = gbp(m.feesCollected, m.currency);
  const isActive = ACTIVE_STATUSES.has(m.status);
  const margin       = fb > 0 ? (fb - dc) / fb : null;
  const realisation  = isActive || fb <= 0 ? null : fc / fb;
  const overrunPct   = bg > 0 ? (fb - bg) / bg : null;
  const idleDays     = isActive ? daysSinceLastActivity(m) : null;
  const dso          = isActive ? null : (typeof m.paymentDays === 'number' ? m.paymentDays : null);
  const flags = [];
  if (overrunPct != null && overrunPct > T.budget) flags.push('over budget');
  if (margin     != null && margin     < T.margin) flags.push('low margin');
  if (isActive && idleDays != null && idleDays > T.stale) flags.push('stale');
  return { fb, wv, bg, margin, realisation, overrunPct, idleDays, dso, isActive, flags };
}

// Warn-coloured pill — mirrors the .status-pill shape (see styles/layout.css)
// but uses --octave-warn tokens so over-budget / low-margin / stale flags read
// the same way the banner-warn does.
function FlagPill({ children }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-display)',
        fontSize: 10,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        padding: '2px 7px',
        borderRadius: 4,
        border: '1px solid var(--octave-warn)',
        color: 'var(--octave-warn)',
        background: 'var(--octave-warn-wash)',
        whiteSpace: 'nowrap',
        marginRight: 4
      }}
    >
      {children}
    </span>
  );
}

const TH = { textAlign: 'left',  padding: '8px 8px', fontWeight: 600 };
const TH_R = { ...TH, textAlign: 'right' };
const TD = { padding: '10px 8px', verticalAlign: 'top' };
const TD_R = { ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

// Column-header label + click-to-open info popover. Mirrors the tile-info
// pattern in [KpiDashboard.jsx](src/pages/KpiDashboard.jsx) — the same
// .kpi-tile-popover styles are reused so look stays consistent across pages.
// `align` controls which edge of the header the popover hangs off so right-
// edge columns (DSO / Flags) don't get clipped by the viewport.
function HeaderInfo({ label, info, isOpen, onToggle, align = 'left' }) {
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
    <span
      ref={ref}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        whiteSpace: 'nowrap'
      }}
    >
      <span>{label}</span>
      <button
        type="button"
        className="kpi-tile-info"
        onClick={() => onToggle(isOpen ? null : label)}
        aria-label={`What is ${label}?`}
        aria-expanded={isOpen}
      >
        <Info size={12} />
      </button>
      {isOpen && (
        <div
          className="kpi-tile-popover"
          role="tooltip"
          style={{
            left:  align === 'right' ? 'auto' : 0,
            right: align === 'right' ? 0      : 'auto',
            width: 380,
            // The popover lives inside a position:relative <span> inside a <th>.
            // The table is wrapped in overflow-x: auto — that implicitly sets
            // overflow-y to auto on most browsers, which would clip the popover.
            // The wrapper overrides overflow to visible while a popover is open
            // (see the parent state below).
            //
            // The reset block below cancels properties the popover inherits
            // from its ancestors that would otherwise leak in:
            //  - whiteSpace: nowrap from the inline-flex header wrapper (would
            //    block formula/note text from wrapping inside the popover)
            //  - textAlign: right from right-aligned numeric <th>s (would push
            //    section labels under the close X)
            //  - textTransform/letterSpacing/fontWeight from any column-header
            //    typography overrides
            whiteSpace: 'normal',
            textAlign: 'left',
            textTransform: 'none',
            letterSpacing: 'normal',
            fontWeight: 400,
            // Leave 24px of clear space below "WHAT IT IS" so it can never
            // collide with the close button at top-right.
            paddingRight: 28
          }}
        >
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

export default function Matters() {
  useTitle('Matters');
  const { currentId } = useWorkspace();
  const [matters, setMatters] = useState([]);
  const [entityMap, setEntityMap] = useState(new Map());
  const [filter, setFilter] = useState('all');
  const [partnerFilter, setPartnerFilter] = useState('all');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  // Which column-header info popover is open, if any. Setting this also
  // toggles the table wrapper to overflow: visible so the popover can extend
  // past the table without being clipped by the implicit overflow-y: auto
  // that browsers apply when overflow-x is auto.
  const [openInfo, setOpenInfo] = useState(null);

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
    () => filtered.reduce((acc, m) => acc + gbp(m.feesBilled, m.currency), 0),
    [filtered]
  );

  return (
    <div>
      <h1>Matters</h1>
      <p className="caption">
        Matter history with commercials — the same per-matter fields the KPI Dashboard and Operational Insights pages aggregate.
        Figures shown in GBP (FX-normalised from native currency). Showing {filtered.length} of {matters.length}.
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

      <div style={{ overflowX: openInfo ? 'visible' : 'auto', marginTop: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 1200 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--octave-n300)' }}>
              <th style={{ ...TH, paddingLeft: 0 }}>ID</th>
              <th style={TH}>Client</th>
              <th style={TH}>Title</th>
              <th style={TH}>Partner</th>
              <th style={TH}>Status</th>
              <th style={TH_R}>Fees billed</th>
              <th style={TH_R}>
                <HeaderInfo
                  label="Worked value"
                  info={COLUMN_INFO['Worked value']}
                  isOpen={openInfo === 'Worked value'}
                  onToggle={setOpenInfo}
                />
              </th>
              <th style={TH_R}>
                <HeaderInfo
                  label="Budget"
                  info={COLUMN_INFO['Budget']}
                  isOpen={openInfo === 'Budget'}
                  onToggle={setOpenInfo}
                />
              </th>
              <th style={TH_R}>
                <HeaderInfo
                  label="Margin"
                  info={COLUMN_INFO['Margin']}
                  isOpen={openInfo === 'Margin'}
                  onToggle={setOpenInfo}
                />
              </th>
              <th style={TH_R}>
                <HeaderInfo
                  label="Realisation"
                  info={COLUMN_INFO['Realisation']}
                  isOpen={openInfo === 'Realisation'}
                  onToggle={setOpenInfo}
                  align="right"
                />
              </th>
              <th style={TH_R}>
                <HeaderInfo
                  label="DSO / Idle"
                  info={COLUMN_INFO['DSO / Idle']}
                  isOpen={openInfo === 'DSO / Idle'}
                  onToggle={setOpenInfo}
                  align="right"
                />
              </th>
              <th style={{ ...TH, paddingRight: 0 }}>
                <HeaderInfo
                  label="Flags"
                  info={COLUMN_INFO['Flags']}
                  isOpen={openInfo === 'Flags'}
                  onToggle={setOpenInfo}
                  align="right"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(m => {
              const client = entityMap.get(m.client);
              const clientName = client?.legalName || m.clientLegalName || m.client || '—';
              const k = deriveMetrics(m);
              const overBudget    = k.overrunPct != null && k.overrunPct > T.budget;
              const lowMargin     = k.margin     != null && k.margin     < T.margin;
              const isStale       = k.isActive && k.idleDays != null && k.idleDays > T.stale;
              return (
                <tr key={m.id} style={{ borderBottom: '1px solid var(--octave-n100)' }}>
                  <td style={{ ...TD, paddingLeft: 0, fontVariantNumeric: 'tabular-nums' }}>{m.id}</td>
                  <td style={TD}>
                    {client ? (
                      <Link to={`/workspaces/${currentId}/clients/${client.id}`}>{clientName}</Link>
                    ) : clientName}
                  </td>
                  <td style={TD}>{m.matterTitle}</td>
                  <td style={TD}>{m.leadPartner || '—'}</td>
                  <td style={TD}>
                    <span className={`status-pill ${k.isActive ? 'status-pill-active' : 'status-pill-closed'}`}>
                      {(prettyStatus(m.status) || labelize(m.status) || '—')}
                    </span>
                  </td>
                  <td style={TD_R}>{k.fb > 0 ? fmtGbp(k.fb) : '—'}</td>
                  <td style={TD_R}>{k.wv > 0 ? fmtGbp(k.wv) : '—'}</td>
                  <td style={TD_R}>
                    {k.bg > 0 ? fmtGbp(k.bg) : '—'}
                    {overBudget && (
                      <div className="exception-value-warn" style={{ fontSize: 11 }}>
                        {fmtPct(k.overrunPct, { signed: true })}
                      </div>
                    )}
                  </td>
                  <td style={TD_R}>
                    <span className={lowMargin ? 'exception-value-warn' : ''}>{fmtPct(k.margin)}</span>
                  </td>
                  <td style={TD_R}>{fmtPct(k.realisation)}</td>
                  <td style={TD_R}>
                    {k.isActive
                      ? (k.idleDays != null
                          ? <span className={isStale ? 'exception-value-warn' : ''}>{`Idle ${k.idleDays}d`}</span>
                          : '—')
                      : (k.dso != null ? `${k.dso}d` : '—')}
                  </td>
                  <td style={{ ...TD, paddingRight: 0 }}>
                    {overBudget && <FlagPill>over budget</FlagPill>}
                    {lowMargin  && <FlagPill>low margin</FlagPill>}
                    {isStale    && <FlagPill>stale</FlagPill>}
                    {!overBudget && !lowMargin && !isStale && <span className="caption">—</span>}
                  </td>
                </tr>
              );
            })}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={12}>
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
                <td colSpan={5} style={{ ...TD, paddingLeft: 0, fontWeight: 500 }}>
                  {filtered.length} matter{filtered.length === 1 ? '' : 's'}
                </td>
                <td style={{ ...TD_R, fontWeight: 500 }}>
                  {totalFees > 0 ? fmtGbp(totalFees) : '—'}
                </td>
                <td colSpan={6} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
