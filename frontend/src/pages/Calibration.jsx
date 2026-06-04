import React, { useEffect, useState } from 'react';
import { Sliders, RotateCcw, Save, Check, AlertCircle, Loader2 } from 'lucide-react';
import { useWorkspace } from '../components/WorkspaceContext.jsx';
import { workspaces as wsApi } from '../api.js';
import { useTitle } from '../lib/useTitle.js';

// Calibration page — five sections of firm-wide dials the engines
// and dashboards read from. Each section explains itself, lets the
// partner edit the values, and saves them with one button. Defaults
// (from the backend's calibration.js) come down with the GET payload
// so a per-section Reset works without a full page reload.

export default function Calibration() {
  useTitle('Calibration');
  const { currentId } = useWorkspace();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    wsApi.calibrationGet(currentId)
      .then(r => { if (!cancelled) setData(r); })
      .catch(err => { if (!cancelled) setLoadError(err.response?.data?.error || err.message); });
    return () => { cancelled = true; };
  }, [currentId]);

  const applyResponse = (r) => setData(r);

  if (loadError) {
    return (
      <div>
        <h1>Calibration</h1>
        <div className="banner-warn" style={{ marginTop: 12 }}>
          <AlertCircle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          Failed to load calibration: {loadError}
        </div>
      </div>
    );
  }
  if (!data) {
    return <div className="caption" style={{ padding: 24 }}>Loading calibration…</div>;
  }

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={EYEBROW_STYLE}>
          <Sliders size={14} /> Firm calibration
        </div>
        <h1 style={{ margin: 0 }}>Calibration</h1>
        <p className="caption" style={{ marginTop: 8, maxWidth: 720 }}>
          The dials that shape how the engines and dashboards behave for your firm. Each setting is firm-wide — every user on this workspace sees the same numbers. Reset any section to fall back to the built-in defaults.
        </p>
        {data.hasOverrides ? (
          <div className="caption" style={{ marginTop: 4, color: 'var(--octave-accent)' }}>
            <Check size={12} style={{ verticalAlign: -1 }} /> Firm overrides are active.
          </div>
        ) : (
          <div className="caption" style={{ marginTop: 4 }}>
            No overrides yet — every section is at its default.
          </div>
        )}
      </div>

      <WorthinessSection
        effective={data.effective.worthiness}
        defaults={data.defaults.worthiness}
        workspaceId={currentId}
        onSaved={applyResponse}
      />
      <OperationalSection
        effective={data.effective.operational}
        defaults={data.defaults.operational}
        workspaceId={currentId}
        onSaved={applyResponse}
      />
      <WalletGapSection
        effective={data.effective.walletGap}
        defaults={data.defaults.walletGap}
        workspaceId={currentId}
        onSaved={applyResponse}
      />
      <RiskFlagsSection
        effective={data.effective.worthiness.riskFlagPenalties}
        defaults={data.defaults.worthiness.riskFlagPenalties}
        worthinessEffective={data.effective.worthiness}
        workspaceId={currentId}
        onSaved={applyResponse}
      />
      <FxAndTimingSection
        effective={data.effective.fxAndTiming}
        defaults={data.defaults.fxAndTiming}
        workspaceId={currentId}
        onSaved={applyResponse}
      />
    </div>
  );
}

// ============================================================
//  Common styles + helpers
// ============================================================

const EYEBROW_STYLE = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontFamily: 'var(--font-display)',
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--octave-text-muted)',
  marginBottom: 8
};

const SECTION_STYLE = {
  marginTop: 24,
  padding: '22px 24px',
  border: '1px solid var(--octave-n300)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--octave-bg)'
};

const ROW_STYLE = {
  display: 'grid',
  gridTemplateColumns: 'minmax(200px, 1fr) 160px',
  alignItems: 'center',
  gap: 16,
  marginTop: 12
};

function Section({ eyebrow, title, lead, children, footer }) {
  return (
    <section style={SECTION_STYLE}>
      <div style={EYEBROW_STYLE}>{eyebrow}</div>
      <h2 style={{ margin: '0 0 6px' }}>{title}</h2>
      <p className="caption" style={{ marginTop: 0, marginBottom: 14 }}>{lead}</p>
      {children}
      {footer && (
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {footer}
        </div>
      )}
    </section>
  );
}

function ActionRow({ onSave, onReset, saving, status }) {
  return (
    <>
      <button type="button" className="btn btn-accent" onClick={onSave} disabled={saving}>
        {saving ? <><Loader2 size={14} className="spin" /> Saving…</> : <><Save size={14} /> Save section</>}
      </button>
      <button type="button" className="btn btn-secondary" onClick={onReset} disabled={saving}>
        <RotateCcw size={14} /> Reset to defaults
      </button>
      {status && (
        <span
          className="caption"
          style={{ color: status.kind === 'ok' ? 'var(--octave-accent)' : 'var(--octave-warn)' }}
        >
          {status.kind === 'ok' ? <Check size={12} /> : <AlertCircle size={12} />}
          {' '}{status.message}
        </span>
      )}
    </>
  );
}

function NumberField({ label, value, onChange, step = 1, min, max, suffix, hint, disabled }) {
  return (
    <div style={ROW_STYLE}>
      <div>
        <div style={{ fontSize: 14 }}>{label}</div>
        {hint && <div className="caption" style={{ marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="number"
          className="input"
          value={value}
          step={step}
          min={min}
          max={max}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
          style={{ width: 110, textAlign: 'right', opacity: disabled ? 0.55 : 1 }}
        />
        {suffix && <span className="caption" style={{ minWidth: 24 }}>{suffix}</span>}
      </div>
    </div>
  );
}

function useSectionState(initialValue) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  // Keep local state in sync when the parent re-fetches.
  useEffect(() => { setValue(initialValue); /* eslint-disable-next-line */ }, [JSON.stringify(initialValue)]);
  return [value, setValue, saving, setSaving, status, setStatus];
}

async function saveSection({ workspaceId, payload, setSaving, setStatus, onSaved }) {
  setSaving(true);
  setStatus(null);
  try {
    const r = await wsApi.calibrationSet(workspaceId, payload);
    onSaved(r);
    setStatus({ kind: 'ok', message: 'Saved.' });
    setTimeout(() => setStatus(null), 2500);
  } catch (err) {
    setStatus({ kind: 'err', message: err.response?.data?.error || err.message });
  } finally {
    setSaving(false);
  }
}

// Two reset shapes:
//   - `{ section, payload: { sub: defaults } }` — partial reset; overwrites
//     just that sub-area with defaults. Used when a section has multiple
//     sub-areas (e.g. worthiness weights vs tierThresholds vs penalties)
//     and the user only wants to reset one of them.
//   - `{ section, fullReset: true }` — true reset: tells the backend to
//     DELETE the stored override for the whole section so it stops
//     counting against hasOverrides.
async function resetSection({ workspaceId, section, payload, fullReset, setSaving, setStatus, onSaved }) {
  setSaving(true);
  setStatus(null);
  try {
    const body = fullReset
      ? { [section]: null }
      : { [section]: payload };
    const r = await wsApi.calibrationSet(workspaceId, body);
    onSaved(r);
    setStatus({ kind: 'ok', message: 'Reset to default.' });
    setTimeout(() => setStatus(null), 2500);
  } catch (err) {
    setStatus({ kind: 'err', message: err.response?.data?.error || err.message });
  } finally {
    setSaving(false);
  }
}

// ============================================================
//  WORTHINESS — weights + tier thresholds
// ============================================================

function WorthinessSection({ effective, defaults, workspaceId, onSaved }) {
  const [weights, setWeights, saving1, setSaving1, status1, setStatus1] = useSectionState(effective.weights);
  const [tiers, setTiers, saving2, setSaving2, status2, setStatus2] = useSectionState(effective.tierThresholds);

  const sum = (Number(weights.profitability) + Number(weights.health) + Number(weights.credit)) || 0;
  const sumValid = sum > 0;

  const saveWeights = () => saveSection({
    workspaceId,
    payload: { worthiness: { weights: {
      profitability: Number(weights.profitability),
      health:        Number(weights.health),
      credit:        Number(weights.credit)
    }}},
    setSaving: setSaving1, setStatus: setStatus1, onSaved
  });
  const resetWeights = () => resetSection({
    workspaceId, section: 'worthiness',
    payload: { weights: defaults.weights },
    setSaving: setSaving1, setStatus: setStatus1, onSaved
  });

  const saveTiers = () => saveSection({
    workspaceId,
    payload: { worthiness: { tierThresholds: {
      high:   Number(tiers.high),
      medium: Number(tiers.medium),
      low:    Number(tiers.low)
    }}},
    setSaving: setSaving2, setStatus: setStatus2, onSaved
  });
  const resetTiers = () => resetSection({
    workspaceId, section: 'worthiness',
    payload: { tierThresholds: defaults.tierThresholds },
    setSaving: setSaving2, setStatus: setStatus2, onSaved
  });

  return (
    <>
      <Section
        eyebrow="Worthiness · Weights"
        title="Fit & Risk Scorer — component weights"
        lead="How much weight to put on each component of the Worthiness score. The three weights are renormalised to sum to 100% on save, so you can think in proportions rather than exact decimals. Risk-averse firms typically push Credit higher; growth-focused firms favour Profitability."
      >
        <NumberField
          label="Profitability weight"
          hint="Margin, realisation, write-off, days-to-pay across the client's closed matters."
          value={weights.profitability}
          step={0.05} min={0} max={1}
          onChange={v => setWeights({ ...weights, profitability: v })}
        />
        <NumberField
          label="Business health weight"
          hint="Risk flags + recent legally-significant signal count."
          value={weights.health}
          step={0.05} min={0} max={1}
          onChange={v => setWeights({ ...weights, health: v })}
        />
        <NumberField
          label="Credit risk weight"
          hint="Public credit rating + outlook."
          value={weights.credit}
          step={0.05} min={0} max={1}
          onChange={v => setWeights({ ...weights, credit: v })}
        />
        <div className="caption" style={{ marginTop: 10 }}>
          Sum: {sumValid ? `${(sum * 100).toFixed(0)}%` : 'invalid'}
          {sumValid && sum !== 1 && <> · will normalise to 100% on save</>}
        </div>
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <ActionRow onSave={saveWeights} onReset={resetWeights} saving={saving1} status={status1} />
        </div>
      </Section>

      <Section
        eyebrow="Worthiness · Tier thresholds"
        title="Tier boundaries — when a score crosses into PURSUE / PURSUE WITH CARE / HOLD / AVOID"
        lead="The overall Worthiness score is a 0-100 number. These three thresholds bucket it into the four tiers shown on every opportunity card. A more conservative firm raises 'high' to 80; a more aggressive firm lowers it to 70."
      >
        <NumberField
          label="High (PURSUE) threshold"
          hint="Scores ≥ this are tagged PURSUE."
          value={tiers.high} step={1} min={0} max={100}
          onChange={v => setTiers({ ...tiers, high: v })}
        />
        <NumberField
          label="Medium (PURSUE WITH CARE) threshold"
          hint="Scores in [medium, high) get the amber tier."
          value={tiers.medium} step={1} min={0} max={100}
          onChange={v => setTiers({ ...tiers, medium: v })}
        />
        <NumberField
          label="Low (HOLD) threshold"
          hint="Scores in [low, medium) get HOLD. Below 'low' is AVOID."
          value={tiers.low} step={1} min={0} max={100}
          onChange={v => setTiers({ ...tiers, low: v })}
        />
        {(() => {
          const lo = Number(tiers.low), me = Number(tiers.medium), hi = Number(tiers.high);
          const ordered = isFinite(lo) && isFinite(me) && isFinite(hi) && lo < me && me < hi;
          if (ordered) return null;
          return (
            <div className="caption" style={{ marginTop: 10, color: 'var(--octave-warn)' }}>
              <AlertCircle size={12} style={{ verticalAlign: -1 }} /> low &lt; medium &lt; high. The save will be rejected until the three values are strictly increasing.
            </div>
          );
        })()}
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <ActionRow onSave={saveTiers} onReset={resetTiers} saving={saving2} status={status2} />
        </div>
      </Section>
    </>
  );
}

// ============================================================
//  OPERATIONAL THRESHOLDS
// ============================================================

function OperationalSection({ effective, defaults, workspaceId, onSaved }) {
  const [v, setV, saving, setSaving, status, setStatus] = useSectionState(effective);

  const save = () => saveSection({
    workspaceId,
    payload: { operational: {
      budgetThreshold: Number(v.budgetThreshold),
      marginThreshold: Number(v.marginThreshold),
      staleDays:       Number(v.staleDays)
    }},
    setSaving, setStatus, onSaved
  });
  const reset = () => resetSection({ workspaceId, section: 'operational', fullReset: true, setSaving, setStatus, onSaved });

  return (
    <Section
      eyebrow="Operational insights · Thresholds"
      title="Exception list thresholds"
      lead="The three thresholds that drive the Operational Insights page (Budget overruns / Unprofitable matters / Stale matters). Different firms have different appetites for what counts as a problem — a tighter shop may flag at 5% over budget, a looser shop at 15%."
    >
      <NumberField
        label="Budget overrun threshold"
        hint="A matter is flagged when feesBilled exceeds budget by this fraction."
        value={v.budgetThreshold} step={0.01} min={0} max={1}
        suffix={`= ${(Number(v.budgetThreshold) * 100).toFixed(0)}%`}
        onChange={x => setV({ ...v, budgetThreshold: x })}
      />
      <NumberField
        label="Margin floor"
        hint="A matter is flagged when (fees - direct cost) / fees falls below this fraction."
        value={v.marginThreshold} step={0.01} min={0} max={1}
        suffix={`= ${(Number(v.marginThreshold) * 100).toFixed(0)}%`}
        onChange={x => setV({ ...v, marginThreshold: x })}
      />
      <NumberField
        label="Stale-matter day count"
        hint="An active matter is flagged when its last-activity exceeds this many days."
        value={v.staleDays} step={1} min={1} max={365}
        suffix="days"
        onChange={x => setV({ ...v, staleDays: x })}
      />
      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <ActionRow onSave={save} onReset={reset} saving={saving} status={status} />
      </div>
    </Section>
  );
}

// ============================================================
//  WALLET-GAP — engine thresholds + capture rate
// ============================================================

function WalletGapSection({ effective, defaults, workspaceId, onSaved }) {
  const [v, setV, saving, setSaving, status, setStatus] = useSectionState(effective);

  const save = () => saveSection({
    workspaceId,
    payload: { walletGap: {
      gapFloorGbp:     Number(v.gapFloorGbp),
      shareCeilingPct: Number(v.shareCeilingPct),
      captureRatePct:  Number(v.captureRatePct)
    }},
    setSaving, setStatus, onSaved
  });
  const reset = () => resetSection({ workspaceId, section: 'walletGap', fullReset: true, setSaving, setStatus, onSaved });

  return (
    <Section
      eyebrow="Wallet-gap engine"
      title="When a wallet-gap opportunity surfaces"
      lead="The wallet-gap engine only emits an opportunity when there's meaningful upside AND the firm doesn't already dominate the relationship. The capture-rate target shapes the £ revenue figure attached to each opp — a conservative firm might assume 15% capture, an aggressive firm 35%."
    >
      <NumberField
        label="Gap floor (£)"
        hint="Skip clients whose addressable gap is below this — not worth a partner conversation."
        value={v.gapFloorGbp} step={50_000} min={0}
        suffix="£"
        onChange={x => setV({ ...v, gapFloorGbp: x })}
      />
      <NumberField
        label="Share ceiling (%)"
        hint="Skip clients where the firm already captures this much of the wallet — no story to tell."
        value={v.shareCeilingPct} step={0.05} min={0} max={1}
        suffix={`= ${(Number(v.shareCeilingPct) * 100).toFixed(0)}%`}
        onChange={x => setV({ ...v, shareCeilingPct: x })}
      />
      <NumberField
        label="Capture-rate target (%)"
        hint="What proportion of the addressable gap the firm could plausibly win. Drives the £ revenue on each wallet-gap opp."
        value={v.captureRatePct} step={0.05} min={0} max={1}
        suffix={`= ${(Number(v.captureRatePct) * 100).toFixed(0)}%`}
        onChange={x => setV({ ...v, captureRatePct: x })}
      />
      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <ActionRow onSave={save} onReset={reset} saving={saving} status={status} />
      </div>
    </Section>
  );
}

// ============================================================
//  RISK FLAGS — penalty table
// ============================================================

function RiskFlagsSection({ effective, defaults, worthinessEffective, workspaceId, onSaved }) {
  const [penalties, setPenalties, saving, setSaving, status, setStatus] = useSectionState(effective);

  const save = () => {
    const cleaned = {};
    for (const [k, v] of Object.entries(penalties)) {
      const num = Number(v);
      if (isFinite(num) && num >= 0) cleaned[k] = num;
    }
    saveSection({
      workspaceId,
      payload: { worthiness: { riskFlagPenalties: cleaned }},
      setSaving, setStatus, onSaved
    });
  };
  const reset = () => resetSection({
    workspaceId, section: 'worthiness',
    payload: { riskFlagPenalties: defaults },
    setSaving, setStatus, onSaved
  });

  // Flags appear in two unions: the keys we already have configured
  // here, plus any defaults that aren't yet overridden. Render the
  // union so adding a new default surfaces in the UI automatically.
  const allFlags = Array.from(new Set([...Object.keys(defaults), ...Object.keys(penalties)]));

  return (
    <Section
      eyebrow="Worthiness · Risk-flag penalties"
      title="How much each risk flag drops the Business Health sub-score"
      lead="When a client carries a risk flag (e.g. distressed, regulatory_pressure), the Business Health sub-score starts at 70 and drops by the configured penalty. Bigger penalty = harsher treatment. Set to 0 to ignore a flag entirely."
    >
      {allFlags.map(flag => (
        <NumberField
          key={flag}
          label={flag.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())}
          hint={`Default: ${defaults[flag] ?? 5}`}
          value={penalties[flag] ?? 0}
          step={1} min={0} max={100}
          suffix="pts"
          onChange={x => setPenalties({ ...penalties, [flag]: x })}
        />
      ))}
      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <ActionRow onSave={save} onReset={reset} saving={saving} status={status} />
      </div>
    </Section>
  );
}

// ============================================================
//  FX & TIMING
// ============================================================

function FxAndTimingSection({ effective, defaults, workspaceId, onSaved }) {
  const [fx, setFx, savingFx, setSavingFx, statusFx, setStatusFx] = useSectionState(effective.fxToGbp);
  const [days, setDays, savingDays, setSavingDays, statusDays, setStatusDays] = useSectionState(effective.trailingWindowDays);

  const saveFx = () => {
    const cleaned = {};
    for (const [k, v] of Object.entries(fx)) {
      const num = Number(v);
      if (isFinite(num) && num > 0) cleaned[k] = num;
    }
    saveSection({
      workspaceId,
      payload: { fxAndTiming: { fxToGbp: cleaned }},
      setSaving: setSavingFx, setStatus: setStatusFx, onSaved
    });
  };
  const resetFx = () => resetSection({
    workspaceId, section: 'fxAndTiming',
    payload: { fxToGbp: defaults.fxToGbp },
    setSaving: setSavingFx, setStatus: setStatusFx, onSaved
  });

  const saveDays = () => saveSection({
    workspaceId,
    payload: { fxAndTiming: { trailingWindowDays: Number(days) }},
    setSaving: setSavingDays, setStatus: setStatusDays, onSaved
  });
  const resetDays = () => resetSection({
    workspaceId, section: 'fxAndTiming',
    payload: { trailingWindowDays: defaults.trailingWindowDays },
    setSaving: setSavingDays, setStatus: setStatusDays, onSaved
  });

  const currencies = Array.from(new Set([...Object.keys(defaults.fxToGbp), ...Object.keys(fx)]));

  return (
    <>
      <Section
        eyebrow="FX rates"
        title="Currency → GBP conversion rates"
        lead="Every per-matter feesBilled lands in its native currency (GBP, USD, EUR). The KPI dashboard + wallet-gap math normalise to GBP using the rates below. In production these would pull from a market-data feed with an as-of stamp; for the demo they're static."
      >
        {currencies.map(ccy => (
          <NumberField
            key={ccy}
            label={`${ccy} → GBP`}
            hint={ccy === 'GBP' ? 'Base currency — locked at 1.00.' : `Default: ${(defaults.fxToGbp[ccy] ?? 1).toFixed(2)}`}
            value={fx[ccy] ?? 1}
            step={0.01} min={0.001}
            disabled={ccy === 'GBP'}
            onChange={x => setFx({ ...fx, [ccy]: x })}
          />
        ))}
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <ActionRow onSave={saveFx} onReset={resetFx} saving={savingFx} status={statusFx} />
        </div>
      </Section>

      <Section
        eyebrow="Trailing window"
        title="How long is &quot;trailing 12 months&quot;?"
        lead="The wallet-gap engine + the KPI dashboard's 12m range filter both use this window to define which closed matters count as 'recent'. Default is 365 days. A firm running quarterly cycles might prefer 90; a firm watching longer arcs might lift it to 730."
      >
        <NumberField
          label="Trailing window"
          hint="Active and in-progress matters always count. Closed matters count when their endDate is within this many days."
          value={days} step={30} min={1} max={3650}
          suffix="days"
          onChange={x => setDays(x)}
        />
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <ActionRow onSave={saveDays} onReset={resetDays} saving={savingDays} status={statusDays} />
        </div>
      </Section>
    </>
  );
}
