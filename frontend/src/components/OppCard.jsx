import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, FileText, MapPin } from 'lucide-react';
import AcronymText from './AcronymText.jsx';

const URGENCY_LABEL = { immediate: 'Immediate', this_week: 'This week', steady_state: 'Steady-state' };
const URGENCY_CLASS = { immediate: 'chip-immediate', this_week: 'chip-this-week', steady_state: 'chip-steady' };

// Severity = magnitude of legal exposure (separate from urgency, which is how
// soon to act). Partner-readable labels — no engineering taxonomy.
const SEVERITY_LABEL = {
  p0: 'Critical · bet-the-firm',
  p1: 'High · material',
  p2: 'Standard',
  p3: 'Watching'
};
const SEVERITY_CLASS = {
  p0: 'chip-accent',
  p1: 'chip-immediate',
  p2: '',
  p3: 'chip-steady'
};

// Display labels for the 14 trigger taxonomy values.
const TRIGGER_LABEL = {
  'litigation': 'Litigation',
  'm-and-a': 'M&A',
  'regulatory': 'Regulatory',
  'sanctions-trade': 'Sanctions / Trade',
  'privacy-data': 'Privacy & Data',
  'ai-governance': 'AI Governance',
  'ip': 'IP',
  'cyber-security': 'Cyber',
  'employment': 'Employment',
  'restructuring': 'Restructuring',
  'esg-climate': 'ESG / Climate',
  'competition-antitrust': 'Antitrust',
  'commercial-contract': 'Commercial',
  'force-majeure': 'Force Majeure'
};
const prettyTrigger = (t) => TRIGGER_LABEL[t] || t.replace(/-/g, ' ');

function ConfBar({ value, basis }) {
  const v = Math.max(0, Math.min(1, value || 0));
  const pct = Math.round(v * 100);
  const band = pct >= 80 ? 'high' : pct >= 60 ? 'moderate' : 'low';
  const bandText = band === 'high'
    ? 'High — source signal is recent and named, claim is well supported.'
    : band === 'moderate'
      ? 'Moderate — usable for a working brief; review the supporting signals before pitching.'
      : 'Low — treat as monitoring/early lead; not pitch-ready.';
  const signalCount = basis?.signalIds?.length || 0;
  const matterCount = basis?.matterReferences?.length || 0;
  const tooltip = `Confidence ${pct}% (${band}). ${bandText} Based on ${signalCount} signal${signalCount === 1 ? '' : 's'} and ${matterCount} relevant past matter${matterCount === 1 ? '' : 's'}.`;
  return (
    <div className={`confidence-bar conf-${band}`} title={tooltip} aria-label={tooltip}>
      <div className="confidence-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function StaleBadge({ days }) {
  if (days == null || isNaN(days)) return null;
  if (days < 7) return null;
  const label = days < 30 ? `${days}d old` : days < 90 ? `${Math.round(days / 7)}w old` : `${Math.round(days / 30)}mo old`;
  const cls = days >= 30 ? 'stale-badge stale-warn' : 'stale-badge';
  return <span className={cls} title={`Most recent supporting signal is ${days} days old`}>{label}</span>;
}

// First sentence of the longer reasoning — used as the "why" line on cards.
function firstSentence(text, max = 160) {
  if (!text) return '';
  const trimmed = text.trim();
  const m = trimmed.match(/^[^.!?]+[.!?]/);
  let out = m ? m[0] : trimmed;
  if (out.length > max) {
    const cut = out.slice(0, max);
    out = cut.slice(0, cut.lastIndexOf(' ')) + '…';
  }
  return out.trim();
}

// Strip robotic source-tag suffixes like "(gdelt)" / "(edgar)" from any field.
function stripSourceSuffix(text) {
  if (!text) return text;
  return text.replace(/\s*\((gdelt|edgar|courtlistener|companies_house|federal_register|doj|ftc|fca|dg_comp|lexology|jd_supra|sanctions_cross_ref|ofac|uk_ofsi)\)\.?\s*$/i, '').trim();
}

// Convert a snake_case service ID into a Title Case label suitable for display.
function prettyService(id) {
  if (!id) return '';
  return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function OppCard({ opp, basePath }) {
  const urgency = opp.urgencyTier || 'steady_state';
  const severity = ['p0', 'p1', 'p2', 'p3'].includes(opp.severity) ? opp.severity : null;
  const triggers = Array.isArray(opp.triggers) ? opp.triggers.slice(0, 3) : [];
  const isSanctions = !!opp.isSanctionsAlert;
  const hasBriefing = !!opp.hasBriefing;
  const ageDays = opp.signalAgeDays;

  const summary = stripSourceSuffix(opp.basis?.summary?.trim()) || 'Opportunity';
  const why = stripSourceSuffix(firstSentence(opp.basis?.reasoning));
  const service = prettyService(opp.suggestedService);
  const jurisdiction = opp.entityJurisdiction;

  return (
    <Link to={`${basePath}/opportunities/${opp.id}`} style={{ textDecoration: 'none' }}>
      <div className={`opp-card ${isSanctions ? 'opp-card-sanctions' : ''}`}>
        {isSanctions && (
          <div className="opp-sanctions-banner">
            <AlertTriangle size={12} /> COMPLIANCE ALERT — escalate, do not pitch
          </div>
        )}

        {/* Top meta row: urgency + jurisdiction + briefing-ready. The
            three pieces of info a partner triages on first. */}
        <div className="opp-card-top-meta">
          <span className={`chip ${URGENCY_CLASS[urgency]}`}>{URGENCY_LABEL[urgency]}</span>
          {severity && (
            <span
              className={`chip ${SEVERITY_CLASS[severity]}`}
              title={`${SEVERITY_LABEL[severity] || severity}. Magnitude of legal exposure, independent of urgency.`}
            >
              {/* Show the partner-readable label rather than the engineering
                  P0/P1/P2/P3 code. The full description lives in the tooltip. */}
              {(SEVERITY_LABEL[severity] || severity).split(' · ')[0]}
            </span>
          )}
          {jurisdiction && (
            <span className="opp-card-juris" title={`Headquartered in ${jurisdiction}`}>
              <MapPin size={11} /> {jurisdiction}
            </span>
          )}
          <StaleBadge days={ageDays} />
          <span className="opp-card-spacer" />
          {hasBriefing && (
            <span className="briefing-ready-badge" title="Full briefing ready">
              <FileText size={11} /> Briefing
            </span>
          )}
        </div>

        {/* Entity is the most important piece — make it the headline. */}
        <h3 className="opp-card-entity"><AcronymText>{opp.entityName || opp.entity}</AcronymText></h3>

        {/* Service tag right under entity — answers "what work?" instantly.
            Trigger tags appear inline to show the risk domain(s) driving the
            need, separate from the service to pitch. */}
        <div className="opp-card-service-row">
          <span className="opp-card-service-tag">{service}</span>
          {triggers.map(t => (
            <span key={t} className="opp-card-trigger-tag" title={`Risk domain: ${prettyTrigger(t)}`}>
              {prettyTrigger(t)}
            </span>
          ))}
        </div>

        {/* Synthesis: what & why, kept short. */}
        <p className="opp-card-summary"><AcronymText>{summary}</AcronymText></p>
        {why && <p className="opp-card-why"><AcronymText>{why}</AcronymText></p>}

        {/* Footer: confidence. */}
        <div className="opp-card-footer">
          <ConfBar value={opp.confidence} basis={opp.basis} />
        </div>
      </div>
    </Link>
  );
}

export { URGENCY_LABEL, URGENCY_CLASS, SEVERITY_LABEL, SEVERITY_CLASS, TRIGGER_LABEL, prettyTrigger };
