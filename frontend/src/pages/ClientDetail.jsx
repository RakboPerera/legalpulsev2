import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, ExternalLink, AlertCircle, Info, X, BookOpen } from 'lucide-react';
import { useWorkspace } from '../components/WorkspaceContext.jsx';
import { workspaces as wsApi } from '../api.js';
import { useTitle } from '../lib/useTitle.js';
import WalletGapMethodologyModal from '../components/WalletGapMethodologyModal.jsx';

// Phase 3 / Change 1 — Wallet-gap section. Reads the methodology
// payload attached to the client's wallet_gap opportunity by
// backend/engines/walletGap.js and renders the deck's slide-6
// breakdown for THIS client (internal billed → estimated total →
// share → gap → top untapped practices).
function fmtGbpCompact(n) {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `£${(n / 1e9).toFixed(1)}bn`;
  if (a >= 1e6) return `£${(n / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `£${(n / 1e3).toFixed(0)}k`;
  return `£${Math.round(n).toLocaleString()}`;
}
function fmtPctOrDash(v) {
  if (v == null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}
const PRACTICE_LABEL_DETAIL = {
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
const prettyPracticeDetail = p => PRACTICE_LABEL_DETAIL[p] || (p || '').replace(/_/g, ' ');

// Layer 1 — per-number info popover anchored next to each big number's
// label. Mirrors the Matters table HeaderInfo pattern and the KPI
// dashboard tile-info pattern. Click toggles; outside-click closes.
// The popover content is shaped { definition, formula, perClient[],
// note } — same vocabulary the partner already sees on the KPI tiles.
function BigNumberInfo({ label, info, isOpen, onToggle }) {
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
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span className="caption">{label}</span>
      <button
        type="button"
        className="kpi-tile-info"
        onClick={() => onToggle(isOpen ? null : label)}
        aria-label={`What is ${label}?`}
        aria-expanded={isOpen}
      >
        <Info size={11} />
      </button>
      {isOpen && (
        <div
          className="kpi-tile-popover"
          role="tooltip"
          style={{ left: 0, right: 'auto', width: 360, textAlign: 'left', whiteSpace: 'normal', textTransform: 'none', letterSpacing: 'normal', fontWeight: 400 }}
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
          {Array.isArray(info.perClient) && info.perClient.length > 0 && (
            <div className="kpi-tile-popover-section">
              <div className="kpi-tile-popover-label">For this client</div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, lineHeight: 1.5 }}>
                {info.perClient.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            </div>
          )}
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

function WalletGapSection({ wallet, entity }) {
  const {
    internalBilledGbp,
    estimatedTotalGbp,
    walletSharePct,
    gapGbp,
    gapByPracticeArea = [],
    methodology = {}
  } = wallet;

  const [openLabel, setOpenLabel] = useState(null);
  const [showModal, setShowModal] = useState(false);

  // Build the per-client "for this client" lines that go into each
  // popover. The lines render LIVE numbers from the engine output —
  // not boilerplate — so a partner reading the popover sees the
  // actual inputs that produced the big number above.
  const revenueGbp = methodology.revenueGbp;
  const sectorRatioBp = methodology.sectorRatio != null ? (methodology.sectorRatio * 10_000).toFixed(0) : null;
  const sizeMult = methodology.sizeAdjustment != null ? methodology.sizeAdjustment.toFixed(2) : null;
  const fy = methodology.fiscalYear;
  const source = methodology.source;
  const sectorLabel = entity?.sector ? prettyPracticeDetail(entity.sector) : null;

  const ESTIMATE_INFO = {
    definition: "External legal spend the client is likely to pay across all firms in a given year — the denominator the firm is competing for on this account.",
    formula: "revenue × sector_benchmark_ratio × size_adjustment",
    perClient: [
      revenueGbp ? `Revenue: ${fmtGbpCompact(revenueGbp)}${fy ? ` (FY${String(fy).slice(-2)}` : ''}${source ? `, ${source}` : ''}${fy ? ')' : ''}` : null,
      sectorRatioBp ? `Sector ratio: ${sectorRatioBp} bp${sectorLabel ? ` (${sectorLabel.toLowerCase()} benchmark)` : ''}` : null,
      sizeMult ? `Size adjustment: ×${sizeMult}${entity?.size ? ` (${entity.size}-cap multiplier)` : ''}` : null,
      `Estimated total: ${fmtGbpCompact(estimatedTotalGbp)}`
    ].filter(Boolean),
    note: "Heuristic anchored to Acritas / CounselLink / AmLaw 200 industry benchmarks. A real-firm deployment refines per sub-sector after calibration; the deck-promised next step is LLM-parsed extraction of the 'legal & professional fees' line item from the client's most recent annual filing."
  };

  const SHARE_INFO = {
    definition: "The proportion of the client's total external legal spend that the firm currently captures.",
    formula: "internal_billed (trailing 12 months) / estimated_total_spend",
    perClient: [
      `Internal billed (trailing 12m): ${fmtGbpCompact(internalBilledGbp)}`,
      `Estimated total spend: ${fmtGbpCompact(estimatedTotalGbp)}`,
      `Wallet share: ${fmtPctOrDash(walletSharePct)}`
    ],
    note: "Mid-tier UK firms typically run 1–5% share across mega-cap multinationals. Single-relationship anchor clients can reach 20%+. The trailing-12m window matches the KPI Dashboard's 12m range filter."
  };

  const GAP_INFO = {
    definition: "Estimated total minus what the firm has billed — the upside left on the table for this client.",
    formula: "estimated_total − internal_billed",
    perClient: [
      `Estimated total: ${fmtGbpCompact(estimatedTotalGbp)}`,
      `Internal billed: ${fmtGbpCompact(internalBilledGbp)}`,
      `Addressable gap: ${fmtGbpCompact(gapGbp)}`,
      gapByPracticeArea.length > 0
        ? `Concentrated in: ${gapByPracticeArea.slice(0, 3).map(prettyPracticeDetail).join(', ')}`
        : null
    ].filter(Boolean),
    note: "An opportunity is emitted for a client only when gap > £500k AND wallet share < 60%. Combine with the Fit & Risk Scorer before any pursuit decision — biggest gap ≠ best target."
  };

  return (
    <>
      <section
        style={{
          marginTop: 16,
          marginBottom: 16,
          padding: '18px 20px',
          border: '1px solid var(--octave-n300)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--octave-bg)'
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 11,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--octave-text-muted)',
            marginBottom: 12
          }}
        >
          Wallet opportunity
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
          <div>
            <BigNumberInfo
              label="Estimated total legal spend"
              info={ESTIMATE_INFO}
              isOpen={openLabel === 'Estimated total legal spend'}
              onToggle={setOpenLabel}
            />
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, marginTop: 2 }}>
              {fmtGbpCompact(estimatedTotalGbp)}
            </div>
            {methodology.fiscalYear && (
              <div className="caption" style={{ marginTop: 2 }}>
                {methodology.fiscalYear} revenue × {((methodology.sectorRatio || 0) * 10_000).toFixed(0)} bp
              </div>
            )}
          </div>
          <div>
            <BigNumberInfo
              label="Your wallet share"
              info={SHARE_INFO}
              isOpen={openLabel === 'Your wallet share'}
              onToggle={setOpenLabel}
            />
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, marginTop: 2 }}>
              {fmtPctOrDash(walletSharePct)}
            </div>
            <div className="caption" style={{ marginTop: 2 }}>
              {fmtGbpCompact(internalBilledGbp)} billed over the trailing 12 months
            </div>
          </div>
          <div>
            <BigNumberInfo
              label="Addressable gap"
              info={GAP_INFO}
              isOpen={openLabel === 'Addressable gap'}
              onToggle={setOpenLabel}
            />
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 24,
                fontWeight: 700,
                marginTop: 2,
                color: 'var(--octave-accent)'
              }}
            >
              {fmtGbpCompact(gapGbp)}
            </div>
            {gapByPracticeArea.length > 0 && (
              <div className="caption" style={{ marginTop: 2 }}>
                concentrated in {gapByPracticeArea.slice(0, 3).map(prettyPracticeDetail).join(', ')}
              </div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {methodology.source && (
            <span className="caption" style={{ fontStyle: 'italic' }}>
              Source: {methodology.source}
            </span>
          )}
          <button
            type="button"
            className="btn-link"
            onClick={() => setShowModal(true)}
            style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <BookOpen size={12} /> How is this computed?
          </button>
        </div>
      </section>
      {showModal && <WalletGapMethodologyModal onClose={() => setShowModal(false)} />}
    </>
  );
}

// Phase 3 / Change 2 — Linked-subsidiaries section. Reads
// entity.linkedSubsidiaries (populated by the subsidiary backfill /
// reconciler at workspace load). Renders a collapsed-by-default list
// grouped by jurisdiction. Each entry shows the discoveredVia tag so
// auditors can trace which public source the entry came from.
function SubsidiariesSection({ subsidiaries }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? subsidiaries : subsidiaries.slice(0, 6);
  // Group counts by jurisdiction for the summary chip row.
  const byJurisdiction = {};
  for (const s of subsidiaries) {
    const j = s.jurisdiction || '—';
    byJurisdiction[j] = (byJurisdiction[j] || 0) + 1;
  }
  return (
    <section
      style={{
        marginTop: 16,
        marginBottom: 16,
        padding: '18px 20px',
        border: '1px solid var(--octave-n300)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--octave-bg)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 11,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--octave-text-muted)'
          }}
        >
          Linked subsidiaries — {subsidiaries.length}
        </div>
        {subsidiaries.length > 6 && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setExpanded(e => !e)}
            style={{ padding: '4px 10px', fontSize: 12 }}
          >
            {expanded ? 'Show top 6' : `Show all ${subsidiaries.length}`}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {Object.entries(byJurisdiction).map(([j, count]) => (
          <span
            key={j}
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 10,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              padding: '2px 8px',
              borderRadius: 3,
              border: '1px solid var(--octave-n300)',
              color: 'var(--octave-text-muted)'
            }}
          >
            {j} · {count}
          </span>
        ))}
      </div>

      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visible.map((s, i) => (
          <li
            key={`${s.name}-${i}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto auto',
              gap: 12,
              alignItems: 'center',
              paddingBottom: 8,
              borderBottom: i === visible.length - 1 ? 'none' : '1px solid var(--octave-n100)'
            }}
          >
            <span>{s.name}</span>
            <span className="caption">{s.jurisdiction || '—'}</span>
            <span className="caption" style={{ fontStyle: 'italic' }}>
              via {(s.discoveredVia || '').replace(/_/g, ' ')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

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

  // Phase 3 — wallet-gap surface. Pull the per-client wallet figures
  // off the (pre-computed) wallet_gap opportunity's basis if there is
  // one. The walletGap engine attaches the full methodology to
  // basis.walletGap, so no extra fetch is needed.
  const walletOpp = (opportunities || []).find(o => o.engineSource === 'wallet_gap');
  const walletGap = walletOpp?.basis?.walletGap || null;

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
        {/* Phase 3 — linked subsidiaries from EDGAR Exhibit 21 / CH PSC
            (or hand-curated for the demo). Counts the entries the
            subsidiaryReconciler / seed backfill associated with this client. */}
        <div className="kpi-tile"><div className="label">Linked subsidiaries</div><div className="value">{(entity.linkedSubsidiaries || []).length}</div></div>
      </div>

      {walletGap && (
        <WalletGapSection wallet={walletGap} entity={entity} />
      )}

      {Array.isArray(entity.linkedSubsidiaries) && entity.linkedSubsidiaries.length > 0 && (
        <SubsidiariesSection subsidiaries={entity.linkedSubsidiaries} />
      )}

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
