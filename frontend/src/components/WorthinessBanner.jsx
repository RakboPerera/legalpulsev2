import React, { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { worthiness as worthinessApi } from '../api.js';

const TIER_LABEL = {
  high:    'PURSUE',
  medium:  'PURSUE WITH CARE',
  low:     'HOLD',
  avoid:   'AVOID',
  unknown: '—'
};

const TIER_ICON = {
  high:    ShieldCheck,
  medium:  ShieldCheck,
  low:     ShieldAlert,
  avoid:   ShieldAlert,
  unknown: ShieldCheck
};

function SubScoreBar({ label, score, weight }) {
  if (score == null) {
    return (
      <div className="worth-sub worth-sub-empty">
        <div className="worth-sub-head">
          <span className="worth-sub-label">{label}</span>
          <span className="worth-sub-na">n/a</span>
        </div>
        <div className="worth-sub-bar"><div className="worth-sub-bar-fill" style={{ width: 0 }} /></div>
        <div className="worth-sub-foot">No prior matter history</div>
      </div>
    );
  }
  return (
    <div className="worth-sub">
      <div className="worth-sub-head">
        <span className="worth-sub-label">{label}</span>
        <span className="worth-sub-score">{score}</span>
        {weight != null && <span className="worth-sub-weight">·&nbsp;{Math.round(weight * 100)}% wt</span>}
      </div>
      <div className="worth-sub-bar">
        <div className="worth-sub-bar-fill" style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

// Always-visible scorecard pinned to the top of every opportunity page.
// Reads the per-entity worthiness object from the API and renders:
//  - Tier chip + overall score (left)
//  - One-sentence verdict
//  - 3 sub-score bars (clients) or 2 (prospects)
//  - Drivers + cautions in two short columns
//
// Per the locked-in decisions: advisory only — never re-ranks the
// opportunity, never gates the action bar. Prospects show a 2-of-3
// disclaimer pill.
export default function WorthinessBanner({ workspaceId, entityId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!workspaceId || !entityId) return;
    let cancelled = false;
    setError(null);
    worthinessApi.forEntity(workspaceId, entityId)
      .then(r => { if (!cancelled) setData(r); })
      .catch(err => { if (!cancelled) setError(err.response?.data?.error || err.message); });
    return () => { cancelled = true; };
  }, [workspaceId, entityId]);

  if (error) {
    return <div className="worth-banner worth-banner-error">Worthiness unavailable: {error}</div>;
  }
  if (!data) {
    return <div className="worth-banner worth-banner-loading">Computing worthiness…</div>;
  }

  const Icon = TIER_ICON[data.tier] || ShieldCheck;
  const tierLabel = TIER_LABEL[data.tier] || '—';
  const isProspect = data.entityType === 'prospect';
  const drivers  = [...(data.profitability?.drivers  || []), ...(data.health.drivers),  ...(data.credit.drivers)];
  const cautions = [...(data.profitability?.cautions || []), ...(data.health.cautions), ...(data.credit.cautions)];

  return (
    <section className={`worth-banner worth-banner-${data.tier}`} aria-label="Client worthiness assessment">
      <header className="worth-banner-head">
        <div className="worth-banner-tag">
          <Icon size={14} />
          <span>Worthiness</span>
          {isProspect && <span className="worth-banner-tag-prospect">· 2 of 3 components</span>}
        </div>
        <div className="worth-banner-score-block">
          <div className="worth-banner-tier">{tierLabel}</div>
          <div className="worth-banner-score">{data.overall}<span className="worth-banner-score-max">/100</span></div>
        </div>
      </header>

      <p className="worth-banner-verdict">{data.verdict}</p>

      <div className="worth-banner-subscores">
        <SubScoreBar label="Profitability"  score={data.profitability?.score ?? null}  weight={data.weights.profitability} />
        <SubScoreBar label="Business health" score={data.health.score}                  weight={data.weights.health} />
        <SubScoreBar label="Credit risk"     score={data.credit.score}                  weight={data.weights.credit} />
      </div>

      {(drivers.length > 0 || cautions.length > 0) && (
        <div className="worth-banner-notes">
          {drivers.length > 0 && (
            <ul className="worth-banner-drivers">
              {drivers.slice(0, 4).map((d, i) => (
                <li key={`d-${i}`}><CheckCircle2 size={12} className="worth-banner-driver-icon" /> {d}</li>
              ))}
            </ul>
          )}
          {cautions.length > 0 && (
            <ul className="worth-banner-cautions">
              {cautions.slice(0, 4).map((c, i) => (
                <li key={`c-${i}`}><AlertCircle size={12} className="worth-banner-caution-icon" /> {c}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {isProspect && (
        <div className="worth-banner-prospect-note">
          <Info size={11} /> No prior matter history with the firm — profitability sub-score skipped.
        </div>
      )}
    </section>
  );
}
