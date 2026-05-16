import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Mail, Check, CircleSlash, Clock, Download, ShieldCheck, ShieldAlert, AlertTriangle, X, FileText, AlertCircle } from 'lucide-react';
import { useWorkspace } from '../components/WorkspaceContext.jsx';
import { opportunities as oppApi } from '../api.js';
import EmailDraftModal from '../components/EmailDraftModal.jsx';
import AcronymText from '../components/AcronymText.jsx';
import OpportunityChat from '../components/OpportunityChat.jsx';
import WorthinessBanner from '../components/WorthinessBanner.jsx';
import PitchModal from '../components/PitchModal.jsx';
import { prettyService, prettySector } from '../lib/labels.js';
import { useTitle } from '../lib/useTitle.js';

const ANGLE_LABEL = {
  commercial: 'Commercial',
  regulatory: 'Regulatory',
  reputational: 'Reputational',
  operational: 'Operational',
  strategic: 'Strategic'
};

const URGENCY_CLASS = { immediate: 'chip-immediate', this_week: 'chip-this-week', steady_state: 'chip-steady' };

const DISMISS_REASONS = [
  { id: 'already_in_progress', label: 'Already in progress through another channel' },
  { id: 'wrong_timing', label: 'Wrong timing' },
  { id: 'wrong_service', label: 'Wrong service' },
  { id: 'relationship_sensitivity', label: 'Relationship sensitivity' },
  { id: 'incorrect_entity', label: 'Incorrect entity match' },
  { id: 'other', label: 'Other' }
];

// If two strings overlap heavily (one is a substring of the other, or they
// share a long common prefix), they're effectively the same content. Used to
// avoid showing the same paragraph twice in the synthesis block when the
// heuristic fallback's `summary` and `detailedExplanation` were derived from
// the same signal.
function isLargelyDuplicate(a, b) {
  if (!a || !b) return false;
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length > 40 && y.includes(x.slice(0, Math.min(80, x.length)))) return true;
  if (y.length > 40 && x.includes(y.slice(0, Math.min(80, y.length)))) return true;
  return false;
}

function StaleBadge({ days }) {
  if (days == null || isNaN(days)) return null;
  if (days < 7) return null;
  const label = days < 30 ? `${days}d old` : days < 90 ? `${Math.round(days / 7)}w old` : `${Math.round(days / 30)}mo old`;
  const cls = days >= 30 ? 'stale-badge stale-warn' : 'stale-badge';
  return <span className={cls} title={`Most recent supporting signal is ${days} days old`}>Signal {label}</span>;
}

function DismissModal({ onClose, onConfirm }) {
  const [reason, setReason] = useState('already_in_progress');
  const [notes, setNotes] = useState('');
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Dismiss opportunity</h3>
          <button onClick={onClose} className="btn-icon-only" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="caption" style={{ marginBottom: 12 }}>
            Capturing the reason helps future recommendations. Three seconds well spent.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {DISMISS_REASONS.map(r => (
              <label key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                <input type="radio" name="dismissReason" value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} />
                <span>{r.label}</span>
              </label>
            ))}
          </div>
          <label className="caption" style={{ display: 'block', marginTop: 16, marginBottom: 6 }}>Notes (optional)</label>
          <textarea className="input" rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onConfirm(reason, notes)}><CircleSlash size={14} /> Confirm dismiss</button>
        </div>
      </div>
    </div>
  );
}

function uniqueSorted(arr) {
  return Array.from(new Set((arr || []).filter(Boolean))).sort();
}

// Render the four scannable point-form sections that sit at the top of the
// briefing-panel: Who they are / The opportunity / Why it's relevant / The play.
// Each section accepts whatever data is available — fields the LLM left blank
// or the workspace doesn't have are simply skipped, never rendered as empty.
function BulletedSections({ opportunity, entity, briefing, signals, entityMatters, urgency, conflict }) {
  const isProspect = opportunity.entityType === 'prospect';
  const headlineSignal = (signals || [])[0];
  const conflicted = conflict?.conflicted;

  // ---- Who they are ----
  const whoBullets = [];
  if (isProspect) {
    whoBullets.push({ label: 'Status', text: 'New client target — currently outside the firm\'s relationship roster. Solicitation rules apply.' });
  } else {
    const maturity = entity?.relationshipMaturity;
    whoBullets.push({ label: 'Status', text: `Existing client${maturity ? ` — ${maturity} relationship` : ''}.` });
  }
  if (entity?.sector) {
    const sub = entity.subSector ? ` (${prettySector(entity.subSector)})` : '';
    whoBullets.push({ label: 'Sector', text: `${prettySector(entity.sector)}${sub}.` });
  }
  if (entity?.hqJurisdiction) {
    const others = (entity.countriesOfOperation || []).filter(c => c !== entity.hqJurisdiction).slice(0, 4);
    const opsLabel = others.length ? `; operates in ${others.join(', ')}${(entity.countriesOfOperation || []).length > others.length + 1 ? '…' : ''}` : '';
    whoBullets.push({ label: 'HQ', text: `${entity.hqJurisdiction}${opsLabel}.` });
  }
  if (entity?.size) {
    whoBullets.push({ label: 'Size', text: `${prettySector(entity.size)} cap.` });
  }
  const decisionMakers = (entity?.decisionMakers || []).slice(0, 3);
  if (decisionMakers.length) {
    whoBullets.push({
      label: 'Key contacts',
      text: decisionMakers.map(dm => `${dm.name} (${dm.role})`).join(' · ') + '.'
    });
  }
  if (!isProspect && entityMatters && entityMatters.length) {
    const services = uniqueSorted(entityMatters.flatMap(m => m.services || [])).slice(0, 4).map(prettyService).join(', ');
    whoBullets.push({
      label: 'Matter history',
      text: `${entityMatters.length} prior matter${entityMatters.length === 1 ? '' : 's'} with the firm${services ? ` across ${services}` : ''}.`
    });
  }

  // ---- The opportunity ----
  const oppBullets = [];
  oppBullets.push({ label: 'Service to pitch', text: `${prettyService(opportunity.suggestedService)}.` });
  // Translate engine identifier into a partner-readable "why we flagged this".
  // The raw engine name (cross_sell / event_intelligence / prospect_discovery)
  // is plumbing — partners only need to know the angle.
  const sourceLine = opportunity.engineSource === 'cross_sell' ? 'Service-gap analysis on an existing client.'
    : opportunity.engineSource === 'event_intelligence' ? 'Time-sensitive market event affecting the entity.'
    : opportunity.engineSource === 'prospect_discovery' ? 'Firm-expertise match against an external signal on a prospect.'
    : 'Analyst-flagged.';
  oppBullets.push({ label: 'Why flagged', text: sourceLine });
  if (headlineSignal) {
    const trimTitle = headlineSignal.title?.slice(0, 140) + (headlineSignal.title?.length > 140 ? '…' : '');
    const dateLabel = headlineSignal.publishedAt ? ` (${headlineSignal.publishedAt.slice(0, 10)})` : '';
    oppBullets.push({ label: 'Trigger', text: `[${headlineSignal.source}] ${trimTitle}${dateLabel}.` });
  }
  if ((signals || []).length > 1) {
    oppBullets.push({ label: 'Supporting signals', text: `${signals.length} cited (see sources below).` });
  }
  oppBullets.push({ label: 'Score', text: `${opportunity.score} / 100 · confidence ${Math.round((opportunity.confidence || 0) * 100)}%.` });

  // ---- Why it's relevant ----
  const whyBullets = [];
  if (briefing?.talkingPoints?.length) {
    for (const tp of briefing.talkingPoints.slice(0, 3)) {
      whyBullets.push({ label: ANGLE_LABEL[tp.angle] || tp.angle, text: tp.point });
    }
  } else if (briefing?.basis?.detailedExplanation || opportunity.basis?.reasoning) {
    const text = briefing?.basis?.detailedExplanation || opportunity.basis?.reasoning;
    const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 20).slice(0, 3);
    for (const s of sentences) whyBullets.push({ text: s });
  }

  // ---- The play ----
  const playBullets = [];
  const recommendedAngle = briefing?.talkingPoints?.[0]?.angle;
  if (recommendedAngle) {
    playBullets.push({
      label: 'Lead with',
      text: `the ${ANGLE_LABEL[recommendedAngle] || recommendedAngle} angle (recommended by the briefing agent).`
    });
  }
  if (briefing?.timingRecommendation) {
    playBullets.push({ label: 'Timing', text: briefing.timingRecommendation });
  } else {
    const timingDefault = urgency === 'immediate' ? 'Contact within 24-48 hours while the signal is fresh.'
      : urgency === 'this_week' ? 'Aim for partner contact within the week.'
      : 'Add to steady-state outreach plan for the next quarterly cycle.';
    playBullets.push({ label: 'Timing', text: timingDefault });
  }
  if (conflicted) {
    playBullets.push({ label: '⚠ Conflict detected', text: 'Do NOT proceed without formal conflicts clearance.', warn: true });
  } else if (conflict) {
    playBullets.push({ label: 'Conflicts', text: 'demo list clear (run formal conflicts before outreach).' });
  }
  if (isProspect) {
    playBullets.push({ label: 'Compliance', text: 'Solicitation rules apply — partner sends manually after review.' });
  }

  // Each section can be opened/closed independently. "Who they are" opens by
  // default so the partner gets immediate context; the other three reveal on
  // click so the page doesn't dump everything at once.
  const [openSections, setOpenSections] = useState({
    who: true, opp: false, why: false, play: false
  });
  const toggle = (key) => setOpenSections(s => ({ ...s, [key]: !s[key] }));

  return (
    <div className="bullet-sections">
      <CollapsibleSection
        title="Who they are"
        tag={isProspect ? 'PROSPECT' : 'EXISTING CLIENT'}
        bullets={whoBullets}
        open={openSections.who}
        onToggle={() => toggle('who')}
      />
      <CollapsibleSection
        title="The opportunity"
        bullets={oppBullets}
        open={openSections.opp}
        onToggle={() => toggle('opp')}
      />
      {whyBullets.length > 0 && (
        <CollapsibleSection
          title="Why it's relevant"
          bullets={whyBullets}
          open={openSections.why}
          onToggle={() => toggle('why')}
        />
      )}
      <CollapsibleSection
        title="The play"
        bullets={playBullets}
        accent
        open={openSections.play}
        onToggle={() => toggle('play')}
      />
    </div>
  );
}

function CollapsibleSection({ title, tag, bullets, accent, open, onToggle }) {
  const count = bullets.length;
  return (
    <div className={`bullet-section ${accent ? 'bullet-section-accent' : ''} ${open ? 'bullet-section-open' : ''}`}>
      <button
        type="button"
        className="bullet-section-head"
        onClick={onToggle}
        aria-expanded={open}
      >
        <h3 className="bullet-section-title">{title}</h3>
        {tag && <span className="bullet-section-tag">{tag}</span>}
        <span className="bullet-section-count">
          {count} point{count === 1 ? '' : 's'}
        </span>
        <ChevronRight size={16} className="bullet-section-chevron" />
      </button>
      {open && (
        <div className="bullet-section-body">
          <ul className="bullet-list">
            {bullets.map((b, i) => (
              <li key={i} className={b.warn ? 'bullet-warn' : ''}>
                {b.label && <strong>{b.label}:</strong>}{b.label ? ' ' : ''}
                <AcronymText>{b.text}</AcronymText>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function OpportunityDetail() {
  const { currentId, viewingRunId, isViewingHistorical } = useWorkspace();
  const { oid } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState(0);
  const [emailOpen, setEmailOpen] = useState(false);
  const [pitchOpen, setPitchOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [conflictRefresh, setConflictRefresh] = useState(null);
  const [conflictBusy, setConflictBusy] = useState(false);
  const [conflictError, setConflictError] = useState(null);
  useTitle(data?.entity?.legalName ? `${data.entity.legalName} — opportunity` : 'Opportunity');

  useEffect(() => {
    if (!currentId || !oid) return;
    // Pass viewingRunId so a historical-run opp resolves against the
    // archived snapshot, including its briefing + cited signals.
    const params = viewingRunId && viewingRunId !== 'live' ? { runId: viewingRunId } : undefined;
    let cancelled = false;
    setError(null);
    setData(null);
    oppApi.get(currentId, oid, params)
      .then(r => { if (!cancelled) setData(r); })
      .catch(err => {
        if (cancelled) return;
        const status = err.response?.status;
        if (status === 404) setError({ kind: 'not_found' });
        else setError({ kind: 'load_failed', message: err.response?.data?.message || err.message });
      });
    return () => { cancelled = true; };
  }, [currentId, oid, viewingRunId, reloadKey]);

  if (error) {
    return (
      <div className="briefing-page">
        <div>
          <Link to={`/workspaces/${currentId}`} className="btn btn-secondary" style={{ width: 'fit-content' }}>
            <ChevronLeft size={16} /> Back
          </Link>
        </div>
        <div className="banner-warn" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
          <AlertCircle size={16} />
          <div style={{ flex: 1 }}>
            {error.kind === 'not_found'
              ? <span>This opportunity isn’t in the current run. It may have been deleted, dismissed, or replaced in a more recent re-bake.</span>
              : <span>We couldn’t load this opportunity. {error.message ? `Reason: ${error.message}.` : ''}</span>}
          </div>
          {error.kind !== 'not_found' && (
            <button className="btn btn-secondary" onClick={() => setReloadKey(k => k + 1)}>Retry</button>
          )}
        </div>
      </div>
    );
  }
  if (!data) return <div className="caption" style={{ padding: 24 }}>Loading opportunity…</div>;
  const { opportunity, entity, briefing, signals, conflictCheck, entityMatters = [] } = data;
  const urgency = opportunity.urgencyTier || 'steady_state';
  const isSanctions = !!opportunity.isSanctionsAlert;
  const signalAgeDays = opportunity.signalAgeDays;
  const conflict = conflictRefresh || conflictCheck;
  const conflicted = conflict?.conflicted;

  const updateStatus = async (status, extra) => {
    await oppApi.update(currentId, oid, { status, ...(extra || {}) });
    const refreshed = await oppApi.get(currentId, oid);
    setData(refreshed);
  };

  const onDismissConfirm = async (dismissReason, notes) => {
    setDismissOpen(false);
    await updateStatus('dismissed', { dismissReason, notes });
  };

  const recheckConflicts = async () => {
    if (!entity?.legalName || conflictBusy) return;
    setConflictBusy(true);
    setConflictError(null);
    try {
      const r = await oppApi.conflictsCheck(currentId, entity.legalName);
      setConflictRefresh(r);
    } catch (err) {
      // Don't swallow — partner needs to know the recheck failed so they
      // don't act on the previous result thinking it's confirmed fresh.
      setConflictError(err.response?.data?.message || err.response?.data?.error || err.message || 'Recheck failed.');
    } finally {
      setConflictBusy(false);
    }
  };

  return (
    <div className="briefing-page">
      <div>
        <Link to={`/workspaces/${currentId}`} className="btn btn-secondary" style={{ width: 'fit-content' }}>
          <ChevronLeft size={16} /> Back
        </Link>
      </div>

      {/* Worthiness banner — pinned above the briefing card per the locked-in
          decision. Advisory only: never re-ranks the opportunity. Renders a
          2-of-3 component variant automatically for prospects. */}
      {opportunity.entity && (
        <WorthinessBanner workspaceId={currentId} entityId={opportunity.entity} />
      )}

      {isSanctions && (
        <div className="sanctions-panel">
          <div className="sanctions-panel-head">
            <ShieldAlert size={18} /> COMPLIANCE ALERT — SANCTIONS CROSS-REFERENCE MATCH
          </div>
          <p>
            One or more cited signals come from a sanctions list (OFAC SDN, EU Consolidated, or UK OFSI).
            This is a compliance matter — not a BD opportunity. Escalate to compliance and obtain clearance
            before any client contact, drafting, or further action.
          </p>
        </div>
      )}

      <div className="briefing-panel">
        <h1><AcronymText>{briefing?.basis?.oneLineHeadline || opportunity.basis?.summary}</AcronymText></h1>

        {/* Triage-not-review preamble — verbatim standing line lifted from the
            anthropics/claude-for-legal launch-radar cookbook. Single source of
            truth on what this page is and is not: an opportunity is a lead
            for partner conversation, not a verdict on the legal need. Sits
            once per briefing, never paraphrased, never dismissible. */}
        <p className="briefing-triage-preamble">
          This is BD triage, not legal advice. Each opportunity is a lead for partner conversation — confirm the underlying facts before any client contact.
        </p>

        <div className="briefing-meta-row" style={{ marginTop: 12, marginBottom: 16 }}>
          <span className={`chip ${URGENCY_CLASS[urgency]}`}>{urgency.replace('_', ' ')}</span>
          {['p0', 'p1', 'p2', 'p3'].includes(opportunity.severity) && (
            <span
              className={`chip ${opportunity.severity === 'p0' ? 'chip-accent' : opportunity.severity === 'p1' ? 'chip-immediate' : opportunity.severity === 'p3' ? 'chip-steady' : ''}`}
              title={`Severity ${opportunity.severity.toUpperCase()} — magnitude of legal exposure, independent of urgency.`}
            >
              {opportunity.severity.toUpperCase()}
            </span>
          )}
          <span className="chip">{opportunity.engineSource?.replace(/_/g, ' ')}</span>
          <span className="chip">{opportunity.entityType === 'prospect' ? 'New outreach' : 'Existing client'}</span>
          {Array.isArray(opportunity.triggers) && opportunity.triggers.slice(0, 3).map(t => (
            <span key={t} className="chip" title={`Risk domain — independent of suggested service`}>
              {(t || '').replace(/-/g, ' ')}
            </span>
          ))}
          <StaleBadge days={signalAgeDays} />
          <span className="caption">score {opportunity.score}</span>
        </div>

        <div className="briefing-entity-row">
          <span><strong className="briefing-entity-name">{entity?.legalName}</strong></span>
          <span>·</span>
          <span>{opportunity.suggestedService?.replace(/_/g, ' ')}</span>
        </div>

        {/* === FOUR POINT-FORM SECTIONS === */}
        <BulletedSections
          opportunity={opportunity}
          entity={entity}
          briefing={briefing}
          signals={signals}
          entityMatters={entityMatters}
          urgency={urgency}
          conflict={conflict}
        />

        {/* === Per-opportunity chat === */}
        <OpportunityChat
          workspaceId={currentId}
          opportunityId={opportunity.id}
          entityName={entity?.legalName}
        />

        {briefing?.talkingPoints?.length > 0 && (
          <>
            <h3 className="briefing-block-h3">Talking points — pick your framing</h3>
            <p className="caption briefing-block-sub">
              Three angles drafted by the briefing agent. Pick the one that fits the relationship.
            </p>
            <div className="tabs">
              {briefing.talkingPoints.map((tp, i) => (
                <button key={i} className={`tab ${tab === i ? 'active' : ''}`} onClick={() => setTab(i)}>
                  {ANGLE_LABEL[tp.angle] || tp.angle}
                  {i === 0 && <span className="recommended-marker" title="Recommended angle for this opportunity">★</span>}
                </button>
              ))}
            </div>
            <p className="briefing-talking-point">
              <AcronymText>{briefing.talkingPoints[tab]?.point}</AcronymText>
            </p>
          </>
        )}

        <hr className="divider" />
        {(() => {
          const cited = (briefing?.basis?.citedSources || signals || []).slice(0, 6);
          const hasAny = cited.length > 0;
          return (
            <>
              <button
                type="button"
                className={`briefing-disclosure ${sourcesOpen ? 'briefing-disclosure-open' : ''}`}
                onClick={() => setSourcesOpen(o => !o)}
                aria-expanded={sourcesOpen}
                disabled={!hasAny}
              >
                <span className="briefing-disclosure-title">Cited sources</span>
                <span className="briefing-disclosure-count">
                  {hasAny ? `${cited.length} source${cited.length === 1 ? '' : 's'}` : 'No external sources cited'}
                </span>
                {hasAny && <ChevronRight size={16} className="briefing-disclosure-chevron" />}
              </button>
              {sourcesOpen && hasAny && (
                <div className="briefing-sources briefing-disclosure-body">
                  {cited.map((s, i) => (
                    <div className="briefing-source-item" key={i}>
                      <div>
                        <a href={s.url || s.sourceUrl} target="_blank" rel="noreferrer">
                          {s.title}
                        </a>
                      </div>
                      <div className="src-meta">[{s.source}] · {s.publishedAt?.slice(0, 10)}</div>
                      {s.excerpt && <div className="src-excerpt">{s.excerpt}</div>}
                    </div>
                  ))}
                </div>
              )}
            </>
          );
        })()}

        <hr className="divider" />
        <div className="conflict-status-row">
          {conflicted ? (
            <div className="conflict-badge conflict-badge-warn">
              <AlertTriangle size={14} /> Conflict detected — {conflict.hits.map(h => h.entityName).join(', ')}.
              Do NOT proceed without clearing through formal conflicts.
            </div>
          ) : conflict ? (
            <div className="conflict-badge conflict-badge-ok">
              <ShieldCheck size={14} /> Conflicts (demo list) clear.
              <span className="caption" style={{ marginLeft: 8 }}>
                Demo conflicts only — always run formal conflicts before outreach.
              </span>
            </div>
          ) : (
            <div className="conflict-badge conflict-badge-pending">
              Conflicts not checked.
              <button
                className="btn btn-secondary"
                style={{ padding: '4px 10px', fontSize: 12, marginLeft: 8 }}
                onClick={recheckConflicts}
                disabled={conflictBusy}
              >
                {conflictBusy ? 'Checking…' : 'Run conflicts check'}
              </button>
              {conflictError && (
                <span className="caption" style={{ color: '#B33', marginLeft: 8 }}>
                  <AlertTriangle size={11} /> {conflictError}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Read-only banner when viewing a historical pipeline run — the
            opp shown here is a SNAPSHOT, not live state. Any mutation
            (status change, briefing generation, email draft) would land
            on the live opp (different identity) or 404, so we disable
            them and explain why. */}
        {isViewingHistorical && (
          <div className="banner-warn" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <ShieldAlert size={14} />
            <span><strong>Viewing archived pipeline run — read-only.</strong> Switch to "Live · current" in the run switcher to make changes.</span>
          </div>
        )}

        <div className="action-bar">
          {isSanctions ? (
            <button className="btn btn-warn" disabled title="Sanctions matches must be escalated to compliance, not pitched">
              <ShieldAlert size={14} /> Escalate to compliance
            </button>
          ) : (
            <>
              <button
                className="btn btn-accent"
                onClick={() => setEmailOpen(true)}
                disabled={conflicted || isViewingHistorical}
                title={isViewingHistorical ? 'Disabled while viewing an archived run' : ''}
              >
                <Mail size={14} /> Generate Email Draft
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => setPitchOpen(true)}
                disabled={conflicted || isViewingHistorical}
                title={isViewingHistorical ? 'Disabled while viewing an archived run' : ''}
              >
                <FileText size={14} /> Draft pitch document
              </button>
            </>
          )}
          <button
            className="btn btn-primary"
            onClick={() => updateStatus('contacted')}
            disabled={isViewingHistorical}
            title={isViewingHistorical ? 'Disabled while viewing an archived run' : ''}
          ><Check size={14} /> Mark contacted</button>
          <button
            className="btn btn-secondary"
            onClick={() => updateStatus('snoozed')}
            disabled={isViewingHistorical}
            title={isViewingHistorical ? 'Disabled while viewing an archived run' : ''}
          ><Clock size={14} /> Snooze</button>
          <button
            className="btn btn-secondary"
            onClick={() => setDismissOpen(true)}
            disabled={isViewingHistorical}
            title={isViewingHistorical ? 'Disabled while viewing an archived run' : ''}
          ><CircleSlash size={14} /> Dismiss</button>
          {/* Developer-only — partners clicking a "Raw JSON" button see a
              tree of fields in a browser tab and assume the page broke.
              Gated behind ?dev=1 or localStorage.lpDev=1, matching the
              demo-banner reload button. */}
          {(typeof window !== 'undefined' && (
            new URLSearchParams(window.location.search).get('dev') === '1' ||
            window.localStorage?.getItem('lpDev') === '1'
          )) && (
            <a className="btn btn-secondary" href={`/api/workspaces/${currentId}/opportunities/${oid}`} target="_blank" rel="noreferrer">
              <Download size={14} /> Raw JSON
            </a>
          )}
        </div>

        <hr className="divider" />
        <button className="btn btn-secondary" onClick={() => setAuditOpen(o => !o)} style={{ width: 'fit-content' }}>
          {auditOpen ? 'Hide' : 'Show'} audit trail entries for this opportunity
        </button>
        {auditOpen && (
          <pre className="briefing-raw-json">
            {JSON.stringify(opportunity, null, 2)}
          </pre>
        )}
      </div>

      {emailOpen && !isSanctions && (
        <EmailDraftModal
          workspaceId={currentId}
          opportunity={opportunity}
          entity={entity}
          briefing={briefing}
          onClose={() => setEmailOpen(false)}
        />
      )}

      {dismissOpen && (
        <DismissModal
          onClose={() => setDismissOpen(false)}
          onConfirm={onDismissConfirm}
        />
      )}

      {pitchOpen && !isSanctions && (
        <PitchModal
          workspaceId={currentId}
          opportunityId={oid}
          entityName={entity?.legalName}
          onClose={() => setPitchOpen(false)}
        />
      )}
    </div>
  );
}
