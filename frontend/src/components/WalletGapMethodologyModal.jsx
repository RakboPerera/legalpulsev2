import React, { useEffect } from 'react';
import { X, BookOpen } from 'lucide-react';
import {
  SECTOR_RATIOS,
  DEFAULT_SECTOR_RATIO_BP,
  SIZE_ADJUSTMENTS,
  FX_RATES,
  TRAILING_12M,
  ENGINE_THRESHOLDS,
  CAVEATS
} from '../lib/walletGapMethodology.js';

// Layer 3 reference modal. Opened from a "How is this computed?" link
// on either ClientDetail's WalletGapSection or the KPI Dashboard
// wallet-gap leaderboard. Exposes everything the backend uses —
// sector ratios, size multipliers, FX, the trailing-12m window, the
// engine thresholds, and the methodology caveats — in scannable
// tables.
//
// Same modal chassis as DismissModal / PitchModal: overlay click and
// Esc both dismiss; click inside the modal doesn't propagate to the
// overlay. The component is purely presentational — no state, no
// data fetching, no API calls.

export default function WalletGapMethodologyModal({ onClose }) {
  // Esc to close — common modal affordance, missing from the other
  // modals in this codebase but easy to add here.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="methodology-title"
        style={{ maxWidth: 760, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="modal-header">
          <h3 id="methodology-title">
            <BookOpen size={18} style={{ verticalAlign: -3, marginRight: 6 }} />
            How the wallet-gap is computed
          </h3>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body" style={{ overflowY: 'auto' }}>
          <p style={{ marginTop: 0 }}>
            For each client the engine computes <code>revenue × sector_ratio × size_adjustment</code> to estimate total external legal spend, then compares that against the firm's trailing-12m billing to derive wallet share and the addressable gap.
          </p>

          <Section title="Sector ratios — % of revenue spent on external legal">
            <table className="kpi-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Sector</th>
                  <th className="num">Ratio (bp)</th>
                  <th>Rationale</th>
                </tr>
              </thead>
              <tbody>
                {SECTOR_RATIOS.map(r => (
                  <tr key={r.sector}>
                    <td>{r.label}</td>
                    <td className="num">{r.bp}</td>
                    <td style={{ color: 'var(--octave-text-muted)' }}>{r.rationale}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ fontStyle: 'italic' }}>Other / unknown</td>
                  <td className="num">{DEFAULT_SECTOR_RATIO_BP}</td>
                  <td style={{ color: 'var(--octave-text-muted)' }}>mid-range default</td>
                </tr>
              </tbody>
            </table>
            <p className="caption" style={{ marginTop: 6 }}>
              Anchored to industry surveys (Acritas · LexisNexis CounselLink · AmLaw 200). 1 bp = 0.01% of revenue.
            </p>
          </Section>

          <Section title="Size adjustment multiplier">
            <table className="kpi-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Size</th>
                  <th className="num">Multiplier</th>
                  <th>Rationale</th>
                </tr>
              </thead>
              <tbody>
                {SIZE_ADJUSTMENTS.map(s => (
                  <tr key={s.size}>
                    <td>{s.label}</td>
                    <td className="num">×{s.multiplier.toFixed(2)}</td>
                    <td style={{ color: 'var(--octave-text-muted)' }}>{s.rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="FX rates (matter currency → GBP)">
            <table className="kpi-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Currency</th>
                  <th className="num">To GBP</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {FX_RATES.map(f => (
                  <tr key={f.currency}>
                    <td>{f.currency}</td>
                    <td className="num">{f.toGbp.toFixed(2)}</td>
                    <td style={{ color: 'var(--octave-text-muted)' }}>{f.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Trailing-12m window (the internalBilled denominator)">
            <p style={{ margin: '4px 0 6px' }}>
              <strong>{TRAILING_12M.windowDays} days.</strong> {TRAILING_12M.rule}
            </p>
          </Section>

          <Section title="Engine thresholds (which clients show up on the board)">
            <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
              <li><strong>Gap floor:</strong> £{(ENGINE_THRESHOLDS.gapFloorGbp / 1e3).toFixed(0)}k — clients below this don't surface.</li>
              <li><strong>Share ceiling:</strong> {(ENGINE_THRESHOLDS.shareCeilingPct * 100).toFixed(0)}% — clients above this already deeply penetrated, no story to tell.</li>
            </ul>
            <p className="caption" style={{ marginTop: 8 }}>{ENGINE_THRESHOLDS.rule}</p>
          </Section>

          <Section title="Caveats">
            <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
              {CAVEATS.map((c, i) => (
                <li key={i} style={{ marginBottom: 6 }}>{c}</li>
              ))}
            </ul>
          </Section>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section style={{ marginTop: 20 }}>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 11,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--octave-text-muted)',
          marginBottom: 8
        }}
      >
        {title}
      </div>
      {children}
    </section>
  );
}
