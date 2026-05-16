import React, { useEffect, useState } from 'react';
import { X, FileText, Download, Sparkles, ChevronRight, RefreshCcw } from 'lucide-react';
import { opportunities as oppApi } from '../api.js';

// Pitch document generator modal.
//
// Flow:
//   1. On open, fetch the retrieved exemplars + any cached pitch.
//   2. Show the exemplars at the top — what the agent is learning from.
//   3. Show the generated pitch in tabbed sections (or invite a click to
//      generate if none cached).
//   4. Offer a Download .docx action when a pitch is available.
//
// The pitch agent is BYOK-gated server-side; the route auto-falls back to a
// deterministic heuristic when no API key is configured, so the modal always
// has something to render.

const TABS = [
  { id: 'summary',      label: 'Executive summary' },
  { id: 'why',          label: 'Why now / Why us' },
  { id: 'team',         label: 'Team & credentials' },
  { id: 'scope',        label: 'Scope & approach' },
  { id: 'fees',         label: 'Fees' }
];

function fmtDate(iso) {
  if (!iso) return '';
  return iso.slice(0, 10);
}

function ExemplarCard({ exemplar }) {
  return (
    <div className="pitch-exemplar-card">
      <div className="pitch-exemplar-head">
        <div className="pitch-exemplar-title">{exemplar.title}</div>
        <div className="pitch-exemplar-match" title={exemplar.matchReasons.join(' · ')}>
          match {exemplar.matchScore}
        </div>
      </div>
      <div className="pitch-exemplar-meta">
        <span>{exemplar.id}</span>
        {exemplar.dateAuthored && <span> · authored {fmtDate(exemplar.dateAuthored)}</span>}
        <span> · {(exemplar.tags || []).slice(0, 3).join(', ')}</span>
      </div>
      <div className="pitch-exemplar-reasons">
        {exemplar.matchReasons.map((r, i) => <span key={i} className="pitch-exemplar-reason">{r}</span>)}
      </div>
    </div>
  );
}

function PitchView({ pitch, activeTab }) {
  if (!pitch) return null;
  switch (activeTab) {
    case 'summary':
      return (
        <div className="pitch-tab-body">
          <h4>{pitch.title}</h4>
          <p>{pitch.executiveSummary}</p>
        </div>
      );
    case 'why':
      return (
        <div className="pitch-tab-body">
          <h4>Why now</h4>
          <p>{pitch.whyNow}</p>
          <h4 style={{ marginTop: 16 }}>Why us</h4>
          <p>{pitch.whyUs}</p>
        </div>
      );
    case 'team':
      return (
        <div className="pitch-tab-body">
          <h4>Team</h4>
          {(pitch.team || []).length === 0
            ? <p className="caption">Team to be confirmed at instruction.</p>
            : <ul className="pitch-list">
                {pitch.team.map((t, i) => (
                  <li key={i}>
                    <strong>{t.name}</strong> — {t.role}
                    {t.rationale && <span className="caption"> · {t.rationale}</span>}
                  </li>
                ))}
              </ul>
          }
          <h4 style={{ marginTop: 16 }}>Relevant credentials</h4>
          {(pitch.credentials || []).length === 0
            ? <p className="caption">Credentials to be added at instruction.</p>
            : <ul className="pitch-list">
                {pitch.credentials.map((c, i) => (
                  <li key={i}>
                    <strong>{c.matterTitle || c.matterId}</strong>
                    {c.oneLine && <> — {c.oneLine}</>}
                    <span className="caption"> [{c.matterId}]</span>
                  </li>
                ))}
              </ul>
          }
        </div>
      );
    case 'scope':
      return (
        <div className="pitch-tab-body">
          <h4>Proposed scope</h4>
          <ul className="pitch-list">{(pitch.scope || []).map((s, i) => <li key={i}>{s}</li>)}</ul>
          <h4 style={{ marginTop: 16 }}>Indicative approach</h4>
          <ul className="pitch-list">{(pitch.approach || []).map((a, i) => <li key={i}>{a}</li>)}</ul>
        </div>
      );
    case 'fees':
      return (
        <div className="pitch-tab-body">
          <h4>Fees & engagement</h4>
          <p>{pitch.feesNote}</p>
        </div>
      );
    default:
      return null;
  }
}

export default function PitchModal({ workspaceId, opportunityId, entityName, onClose }) {
  const [exemplars, setExemplars] = useState([]);
  const [pitch, setPitch] = useState(null);
  const [loadingExemplars, setLoadingExemplars] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('summary');

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoadingExemplars(true);
    Promise.all([
      oppApi.pitchExemplars(workspaceId, opportunityId, 4),
      oppApi.getPitch(workspaceId, opportunityId).catch(err => err.response?.status === 404 ? null : Promise.reject(err))
    ])
      .then(([ex, cached]) => {
        if (cancelled) return;
        setExemplars(ex.exemplars || []);
        if (cached?.pitch) setPitch(cached.pitch);
      })
      .catch(err => { if (!cancelled) setError(err.response?.data?.error || err.message); })
      .finally(() => { if (!cancelled) setLoadingExemplars(false); });
    return () => { cancelled = true; };
  }, [workspaceId, opportunityId]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const r = await oppApi.generatePitch(workspaceId, opportunityId);
      setPitch(r.pitch);
      setActiveTab('summary');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = () => {
    window.open(oppApi.pitchDocxUrl(workspaceId, opportunityId), '_blank');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal pitch-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3><FileText size={18} style={{ verticalAlign: -3 }} /> Pitch document</h3>
            <p className="caption" style={{ marginTop: 4 }}>
              {entityName ? <>For <strong>{entityName}</strong>. </> : null}
              The generator learns from the firm's prior pitches on similar mandates.
            </p>
          </div>
          <button onClick={onClose} className="btn-icon-only" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="modal-body pitch-modal-body">
          {error && <div className="banner-warn">{error}</div>}

          {/* === Exemplars block === */}
          <section className="pitch-section">
            <h4 className="pitch-section-title">Learning from these prior pitches</h4>
            {loadingExemplars
              ? <div className="caption">Loading exemplars…</div>
              : exemplars.length === 0
                ? <div className="empty-state">No matching prior pitches found — the agent will use general partner-pitch conventions.</div>
                : <div className="pitch-exemplar-list">
                    {exemplars.map(e => <ExemplarCard key={e.id} exemplar={e} />)}
                  </div>
            }
          </section>

          <hr className="divider" />

          {/* === Pitch view === */}
          {pitch ? (
            <section className="pitch-section">
              <div className="pitch-section-headline">
                <h4 className="pitch-section-title">
                  Generated pitch
                </h4>
                <div className="pitch-actions">
                  <button className="btn btn-secondary" onClick={handleGenerate} disabled={generating}>
                    <RefreshCcw size={14} /> Regenerate
                  </button>
                  <button className="btn btn-accent" onClick={handleDownload}>
                    <Download size={14} /> Download .docx
                  </button>
                </div>
              </div>
              <div className="tabs pitch-tabs">
                {TABS.map(t => (
                  <button
                    key={t.id}
                    className={`tab ${activeTab === t.id ? 'active' : ''}`}
                    onClick={() => setActiveTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <PitchView pitch={pitch} activeTab={activeTab} />
              <div className="pitch-foot caption">
                Generated {pitch.generatedAt?.slice(0, 19).replace('T', ' ')}
                {pitch.exemplarPitchIds?.length ? <> · drew from {pitch.exemplarPitchIds.length} prior pitch{pitch.exemplarPitchIds.length === 1 ? '' : 'es'}</> : null}
              </div>
            </section>
          ) : (
            <section className="pitch-section pitch-section-cta">
              <div className="pitch-cta-icon"><Sparkles size={24} /></div>
              <h4 className="pitch-section-title">Ready to draft</h4>
              <p>
                The generator will produce a partner-ready pitch using the exemplars above as voice and structure references.
                You can review every section before downloading.
              </p>
              <button className="btn btn-accent" onClick={handleGenerate} disabled={generating}>
                {generating
                  ? <>Drafting… <RefreshCcw size={14} className="spin" /></>
                  : <>Draft pitch <ChevronRight size={14} /></>}
              </button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
