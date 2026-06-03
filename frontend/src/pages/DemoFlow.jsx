import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PlayCircle, Target, FileSearch, ShieldCheck, FileText, Workflow,
  ChevronLeft, ChevronRight, ArrowRight, Layers
} from 'lucide-react';
import { useWorkspace } from '../components/WorkspaceContext.jsx';
import {
  opportunities as oppApi,
  worthiness as worthinessApi,
  workspaces as wsApi
} from '../api.js';
import { useTitle } from '../lib/useTitle.js';

// Demo Flow — a 5-step guided walkthrough that surfaces the five
// highest-value moments of the product in the order a colleague ranked
// them for a partner audience. Each step has:
//   1. The colleague's value statement (paraphrased, partner-readable)
//   2. A live data preview pulled from the real demo workspace
//   3. A "See it in context" CTA that opens the matching live page
// Lives at /workspaces/:id/demo-flow. Toggle in/out via the sidebar
// nav — there's no overlay or mode-takeover.

const STEPS = [
  {
    n: 1,
    Icon: Target,
    title: 'The opportunity they couldn’t see',
    valueStatement:
      'The hero of the demo is the wallet-share gap. A partner believes the firm captures ~70% of a marquee client; public filings say ~30%. The £-figure on the table is the single sharpest "aha" you can put in front of a managing partner. The event-driven scan (a sanctions event that just exposed 100 shipowners; an Aramco/Hormuz play) is the dramatic second act.',
    bullet: 'Reveals revenue the firm can’t see today, with a £-figure they can take to the next partnership meeting.'
  },
  {
    n: 2,
    Icon: FileSearch,
    title: 'Every fact carries a court docket',
    valueStatement:
      'A surprise is interesting. A cited surprise is actionable. This is the single biggest differentiator vs the 300–400 point tools, none of which can defensibly source a cross-domain claim. Real CourtListener dockets, EDGAR filings and OFAC entries — with case numbers — convert the senior partner who would otherwise say "nice, but I can’t rely on it."',
    bullet: 'Without provenance, the AI assertion is unverifiable; with it, the partner can pre-empt the cross-examination at the engagement-pitch table.'
  },
  {
    n: 3,
    Icon: ShieldCheck,
    title: 'From 50 opportunities to ranked intelligence',
    valueStatement:
      'Surfacing 50 opportunities is noise; ranking them by fit, profitability and creditworthiness is intelligence. This is the score that resolves the BD-vs-finance tension that calls keep surfacing — BD wants every client, finance wants to vet them. The worthiness score (Profitability + Business Health + Credit Risk, backed by margin / realisation / days-to-pay) is a genuinely distinctive angle most competitors ignore.',
    bullet: 'Brings the CFO onside, which matters because the CFO holds the budget.'
  },
  {
    n: 4,
    Icon: FileText,
    title: 'Pitch-ready output and an action layer',
    valueStatement:
      'A surfaced opportunity becomes a drafted briefing, an email, a pitch document, and selectable framing angles — commercial / relationship / competitive — in seconds. This is the "we could double our pitch coverage with the same team" moment. It also makes the product feel usable today, not aspirational.',
    bullet: 'The feature that closes the head of BD.'
  },
  {
    n: 5,
    Icon: Workflow,
    title: 'Show me the machine didn’t hallucinate',
    valueStatement:
      'For a risk-averse firm — and its risk committee — the explainability audit is the closer that stops a deal dying on trust grounds. Walk through ingest → dedup → classify → cluster → cite, with per-signal reasons. Provenance proves the facts are real; the audit proves the system reasoned soundly and transparently.',
    bullet: 'Lead the trust portion of the demo here, not on the KPI dashboard.'
  }
];

const CONNECTIVE_TISSUE = `The connective tissue underneath all five is multi-source unification — internal case + finance + CRM data fused with public signals into one cited view. That synthesis is the moat that justifies the price vs single-purpose tools; it’s why the wallet-gap and the pitch-ready output are even possible.`;

// === Helpers — local to this page ===
function fmtGbpCompact(n) {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `£${(n / 1e9).toFixed(1)}bn`;
  if (a >= 1e6) return `£${(n / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `£${(n / 1e3).toFixed(0)}k`;
  return `£${Math.round(n).toLocaleString()}`;
}
function fmtPct(v) {
  if (v == null || !isFinite(v)) return '—';
  return `${(v * 100).toFixed(1)}%`;
}
function fmtDurationMs(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

// Resolve the current step from a URL hash like "#step-3". Defaults to 1
// for any invalid value so a partner deep-linking from a bookmark with a
// typo still lands somewhere sensible.
function readStepFromHash() {
  if (typeof window === 'undefined') return 1;
  const m = window.location.hash.match(/^#step-([1-5])$/);
  return m ? Number(m[1]) : 1;
}

export default function DemoFlow() {
  useTitle('Demo Flow');
  const { currentId } = useWorkspace();
  const [step, setStep] = useState(readStepFromHash());
  const [data, setData] = useState(null);
  const [errors, setErrors] = useState({});

  // Single fetch on mount — everything the 5 steps need lands in one
  // bundle and the page renders from cache as the partner navigates.
  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    const errs = {};

    const fetches = [
      oppApi.list(currentId, { limit: 500 })
        .catch(err => { errs.opps = err.message; return { opportunities: [] }; }),
      oppApi.pitchMetrics(currentId)
        .catch(err => { errs.pitchMetrics = err.message; return null; }),
      wsApi.signals(currentId, { limit: 5 })
        .catch(err => { errs.signals = err.message; return { total: null }; }),
      wsApi.audit(currentId, { limit: 500 })
        .catch(err => { errs.audit = err.message; return { entries: [] }; })
    ];

    Promise.all(fetches).then(async ([oppRes, pitchMetrics, signalRes, auditRes]) => {
      if (cancelled) return;
      const opps = oppRes.opportunities || [];

      // Pick the demo's top wallet-gap opp (largest gap £). This anchors
      // steps 1, 2, 3 and 4 — same opp threads through the narrative so
      // the partner sees the same client name escalate from "surprise"
      // to "pitch-ready output".
      const walletOpps = opps
        .filter(o => o.engineSource === 'wallet_gap')
        .sort((a, b) => (b.basis?.walletGap?.gapGbp || 0) - (a.basis?.walletGap?.gapGbp || 0));
      const heroOpp = walletOpps[0] || null;

      const eventOpps = opps
        .filter(o => o.engineSource === 'event_intelligence')
        .sort((a, b) => (b.score || 0) - (a.score || 0));
      const eventOpp = eventOpps[0] || null;

      // Worthiness for the hero opp's entity — the Fit & Risk Scorer
      // preview on step 3. Skipped silently if worthiness fails (the
      // step still has a graceful fallback).
      let heroWorth = null;
      if (heroOpp?.entity) {
        try {
          heroWorth = await worthinessApi.forEntity(currentId, heroOpp.entity);
        } catch (err) {
          errs.worthiness = err.message;
        }
      }

      // Funnel counts for step 5 — pulled from the audit log entries.
      // Each engine run / classification / etc. contributes a count.
      // Falls back to "—" on any individual stage that doesn't have an
      // entry in the log (the page never crashes on missing data).
      const entries = auditRes.entries || [];
      const countOfType = type => entries.filter(e => e.type === type).length;
      const sumOutput = (type, key) => entries
        .filter(e => e.type === type)
        .reduce((s, e) => s + (Number(e.outputs?.[key]) || 0), 0);

      // Best-effort funnel: we read whichever entries the audit log has
      // for the current workspace. Some stages may report 0 — that's
      // fine; the funnel still tells the trust story.
      const funnel = {
        ingest:   sumOutput('ingestion', 'beforeDedup') || (signalRes.total ?? null),
        dedup:    sumOutput('ingestion', 'afterDedup')  || (signalRes.total ?? null),
        classify: sumOutput('classification', 'signalsClassified') || (signalRes.total ?? null),
        cluster:  countOfType('event_cluster') || opps.length,
        cite:     opps.filter(o => (o.basis?.signalIds || []).length > 0).length
      };

      setData({
        heroOpp,
        eventOpp,
        heroWorth,
        pitchMetrics,
        funnel
      });
      setErrors(errs);
    });

    return () => { cancelled = true; };
  }, [currentId]);

  // Keep the URL hash in sync so the step is deep-linkable.
  useEffect(() => {
    const expected = `#step-${step}`;
    if (window.location.hash !== expected) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${expected}`);
    }
  }, [step]);

  const currentStep = STEPS.find(s => s.n === step);
  const drillInTarget = useMemo(() => {
    if (!data || !currentId) return null;
    if (step === 5) return `/workspaces/${currentId}/reasoning`;
    if (data.heroOpp) return `/workspaces/${currentId}/opportunities/${data.heroOpp.id}`;
    return null;
  }, [step, data, currentId]);

  // === Render ===
  return (
    <div className="demo-flow-page" style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 60 }}>
      <header style={{ marginBottom: 24 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontFamily: 'var(--font-display)',
            fontSize: 11,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--octave-text-muted)',
            marginBottom: 8
          }}
        >
          <PlayCircle size={14} />
          Demo flow
        </div>
        <h1 style={{ margin: 0 }}>Guided walkthrough</h1>
        <p className="caption" style={{ marginTop: 8, maxWidth: 720 }}>
          The five highest-value moments your audience needs to see, in the order they convert. Each step previews a live tile from this workspace and links to the page where you'd actually demo it.
        </p>
      </header>

      {/* === STEP NAVIGATOR === */}
      <StepNavigator step={step} onSelect={setStep} />

      {/* === STEP HEADER + VALUE STATEMENT === */}
      <section
        style={{
          marginTop: 24,
          padding: '24px 28px',
          background: 'var(--octave-panel)',
          color: '#fff',
          borderRadius: 'var(--radius-md)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 12 }}>
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: 56,
              lineHeight: 1,
              color: 'var(--octave-accent)'
            }}
          >
            {String(currentStep.n).padStart(2, '0')}
          </span>
          <h2 style={{ margin: 0, color: '#fff' }}>{currentStep.title}</h2>
        </div>
        <p style={{ margin: 0, lineHeight: 1.6, color: 'rgba(255,255,255,0.88)', maxWidth: 820 }}>
          {currentStep.valueStatement}
        </p>
        <div
          style={{
            marginTop: 14,
            paddingTop: 14,
            borderTop: '1px solid rgba(255,255,255,0.15)',
            fontFamily: 'var(--font-display)',
            fontSize: 12,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--octave-accent)'
          }}
        >
          Why this lands first
        </div>
        <p style={{ margin: '6px 0 0', color: 'rgba(255,255,255,0.88)', fontSize: 14, fontStyle: 'italic' }}>
          {currentStep.bullet}
        </p>
      </section>

      {/* === LIVE PREVIEW === */}
      <section
        style={{
          marginTop: 24,
          padding: '24px 28px',
          background: 'var(--octave-bg)',
          border: '1px solid var(--octave-n300)',
          borderRadius: 'var(--radius-md)'
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 11,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--octave-text-muted)',
            marginBottom: 14
          }}
        >
          Live preview — pulled from this workspace
        </div>
        {!data && <div className="caption">Loading demo data…</div>}
        {data && step === 1 && <Step1Preview heroOpp={data.heroOpp} eventOpp={data.eventOpp} />}
        {data && step === 2 && <Step2Preview heroOpp={data.heroOpp} />}
        {data && step === 3 && <Step3Preview heroWorth={data.heroWorth} heroOpp={data.heroOpp} />}
        {data && step === 4 && <Step4Preview pitchMetrics={data.pitchMetrics} />}
        {data && step === 5 && <Step5Preview funnel={data.funnel} />}
      </section>

      {/* === NAVIGATION ROW === */}
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginTop: 24,
          flexWrap: 'wrap'
        }}
      >
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setStep(s => Math.max(1, s - 1))}
          disabled={step === 1}
        >
          <ChevronLeft size={14} /> Previous
        </button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          {drillInTarget ? (
            <Link to={drillInTarget} className="btn btn-accent">
              See it in context <ArrowRight size={14} />
            </Link>
          ) : (
            <span className="caption">Live page unavailable</span>
          )}
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setStep(s => Math.min(5, s + 1))}
          disabled={step === 5}
        >
          Next <ChevronRight size={14} />
        </button>
      </nav>

      {/* === CONNECTIVE TISSUE === */}
      <section
        style={{
          marginTop: 32,
          padding: '18px 22px',
          border: '1px dashed var(--octave-n300)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--octave-n100)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <Layers size={14} style={{ color: 'var(--octave-text-muted)' }} />
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 11,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--octave-text-muted)'
            }}
          >
            Connective tissue
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
          {CONNECTIVE_TISSUE}
        </p>
      </section>
    </div>
  );
}

// ============================================================
//  Sub-components
// ============================================================

function StepNavigator({ step, onSelect }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 8
      }}
    >
      {STEPS.map(s => {
        const isActive = s.n === step;
        return (
          <button
            key={s.n}
            type="button"
            onClick={() => onSelect(s.n)}
            style={{
              background: isActive ? 'var(--octave-accent)' : 'var(--octave-bg)',
              color: isActive ? 'var(--octave-panel)' : 'var(--octave-text)',
              border: `1px solid ${isActive ? 'var(--octave-accent)' : 'var(--octave-n300)'}`,
              borderRadius: 'var(--radius-md)',
              padding: '12px 14px',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.12s'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <s.Icon size={14} />
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: 14
                }}
              >
                {String(s.n).padStart(2, '0')}
              </span>
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 12,
                lineHeight: 1.35,
                color: isActive ? 'var(--octave-panel)' : 'var(--octave-text-muted)'
              }}
            >
              {s.title}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// === Step 1 — Gap-based surfacing ===
function Step1Preview({ heroOpp, eventOpp }) {
  if (!heroOpp) {
    return <div className="caption">No wallet-gap opportunities found in this workspace.</div>;
  }
  const wg = heroOpp.basis?.walletGap;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
      <PreviewCard
        eyebrow="The wallet-share gap (hero play)"
        title={heroOpp.entityName || heroOpp.entity}
        bigStat={fmtGbpCompact(wg?.gapGbp)}
        bigStatLabel="addressable gap"
        rows={[
          { label: 'You capture', value: fmtPct(wg?.walletSharePct) },
          { label: 'Estimated total', value: fmtGbpCompact(wg?.estimatedTotalGbp) },
          { label: 'Untapped practices', value: (wg?.gapByPracticeArea || []).slice(0, 3).map(p => p.replace(/_/g, ' ')).join(', ') || '—' }
        ]}
        footer={heroOpp.basis?.summary || ''}
      />
      {eventOpp && (
        <PreviewCard
          eyebrow="The event-driven scan (dramatic second act)"
          title={eventOpp.entityName || eventOpp.entity}
          bigStat={`${eventOpp.score}/100`}
          bigStatLabel="opportunity score"
          rows={[
            { label: 'Urgency', value: (eventOpp.urgencyTier || '').replace(/_/g, ' ') },
            { label: 'Severity', value: (eventOpp.severity || '').toUpperCase() },
            { label: 'Triggers', value: (eventOpp.triggers || []).join(', ') || '—' }
          ]}
          footer={eventOpp.basis?.summary || ''}
        />
      )}
    </div>
  );
}

// === Step 2 — Cited provenance ===
function Step2Preview({ heroOpp }) {
  if (!heroOpp) return <div className="caption">No opportunity to inspect.</div>;
  // We don't have full signal payloads here without a second fetch
  // (the list endpoint returns signalIds, not the signal records).
  // The drill-in CTA opens the live audit panel for the full citation
  // view; here we just show the ID list as proof that every claim is
  // pinned to a source.
  const signalIds = heroOpp.basis?.signalIds || [];
  const matterRefs = heroOpp.basis?.matterReferences || [];
  return (
    <div>
      <p style={{ margin: '0 0 14px', maxWidth: 720 }}>
        Every recommendation is anchored to one or more public sources. For <strong>{heroOpp.entityName}</strong>'s wallet-gap play, the engine pinned its claim to:
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        <div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 11,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--octave-text-muted)',
              marginBottom: 6
            }}
          >
            Cited signals
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700 }}>{signalIds.length}</div>
          <div className="caption" style={{ marginTop: 4 }}>
            CourtListener / EDGAR / OFAC / Tavily-news IDs — drill in to see the full title + date + URL per source.
          </div>
        </div>
        <div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 11,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--octave-text-muted)',
              marginBottom: 6
            }}
          >
            Internal-matter references
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700 }}>{matterRefs.length}</div>
          <div className="caption" style={{ marginTop: 4 }}>
            Prior matters the engine considered when shaping the recommendation. The internal-public bridge is the moat.
          </div>
        </div>
      </div>
      <p className="caption" style={{ marginTop: 14, fontStyle: 'italic' }}>
        On the live page, the Evidence trail section of the audit panel resolves each ID to its source title, publication date, and clickable URL — the exact thing the skeptical senior partner needs to interrogate the recommendation.
      </p>
    </div>
  );
}

// === Step 3 — Fit & Risk Scorer ===
function Step3Preview({ heroWorth, heroOpp }) {
  if (!heroWorth) {
    return (
      <div className="caption">
        Fit &amp; Risk Scorer data not available {heroOpp?.entityName ? `for ${heroOpp.entityName}` : ''}. The live banner on the opportunity page renders the full breakdown.
      </div>
    );
  }
  const tierLabel = {
    high: 'PURSUE',
    medium: 'PURSUE WITH CARE',
    low: 'HOLD',
    avoid: 'AVOID',
    unknown: '—'
  }[heroWorth.tier] || '—';
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div className="caption">{heroWorth.entityName}</div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 11,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--octave-accent)',
              fontWeight: 700
            }}
          >
            {tierLabel}
          </div>
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 44, lineHeight: 1 }}>
          {heroWorth.overall}
          <span style={{ fontSize: 16, color: 'var(--octave-text-muted)' }}>/100</span>
        </div>
      </div>
      <p style={{ marginTop: 10, fontStyle: 'italic' }}>{heroWorth.verdict}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginTop: 16 }}>
        {[
          { label: 'Profitability', score: heroWorth.profitability?.score, weight: heroWorth.weights?.profitability },
          { label: 'Business health', score: heroWorth.health?.score,        weight: heroWorth.weights?.health },
          { label: 'Credit risk',    score: heroWorth.credit?.score,         weight: heroWorth.weights?.credit }
        ].map(c => (
          <div key={c.label}>
            <div className="caption">{c.label}{c.weight != null ? ` (${Math.round(c.weight * 100)}% wt)` : ''}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, marginTop: 2 }}>
              {c.score == null ? 'n/a' : c.score}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// === Step 4 — Pitch-ready output ===
function Step4Preview({ pitchMetrics }) {
  return (
    <div>
      <p style={{ margin: '0 0 14px', maxWidth: 720 }}>
        The action bar on every opportunity ships briefing prose, an email draft, and a pitch document — generated in seconds, with selectable framing angles. Below is what the live action bar offers:
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Generate Email Draft', sub: 'Subject + body, conflict-checked.' },
          { label: 'Draft Pitch Document', sub: 'DOCX with framing angle picker.' },
          { label: 'Mark contacted',       sub: 'Lifecycle event logged.' },
          { label: 'Snooze / Dismiss',     sub: 'With dismiss-reason capture.' }
        ].map(b => (
          <div
            key={b.label}
            style={{
              padding: '12px 14px',
              background: 'var(--octave-n100)',
              border: '1px solid var(--octave-n300)',
              borderRadius: 'var(--radius-sm)'
            }}
          >
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13 }}>{b.label}</div>
            <div className="caption" style={{ marginTop: 2 }}>{b.sub}</div>
          </div>
        ))}
      </div>
      {pitchMetrics && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 14,
            padding: '14px 16px',
            background: 'var(--octave-bg)',
            border: '1px solid var(--octave-n300)',
            borderRadius: 'var(--radius-sm)'
          }}
        >
          <Stat label="Pitches generated" value={pitchMetrics.totalPitches} />
          <Stat label="This quarter" value={pitchMetrics.pitchesThisQuarter} />
          <Stat label="Avg generation time" value={fmtDurationMs(pitchMetrics.avgGenerationMs)} />
          <Stat label="Conversion rate" value={pitchMetrics.conversionRate != null ? `${Math.round(pitchMetrics.conversionRate * 100)}%` : '—'} />
        </div>
      )}
    </div>
  );
}

// === Step 5 — Reasoning audit ===
function Step5Preview({ funnel }) {
  const stages = [
    { key: 'ingest',   label: 'Ingest',    value: funnel.ingest,   desc: 'Raw signals pulled from public sources.' },
    { key: 'dedup',    label: 'Dedup',     value: funnel.dedup,    desc: 'URL canonicalised; cross-source duplicates collapsed.' },
    { key: 'classify', label: 'Classify',  value: funnel.classify, desc: 'Legally significant vs noise.' },
    { key: 'cluster',  label: 'Cluster',   value: funnel.cluster,  desc: 'Event-level grouping; entity linked.' },
    { key: 'cite',     label: 'Cite',      value: funnel.cite,     desc: 'Opportunities with at least one source citation.' }
  ];
  return (
    <div>
      <p style={{ margin: '0 0 16px', maxWidth: 720 }}>
        Every recommendation passes through a five-stage pipeline before a partner sees it. The audit log records the input, output and reasoning at each step — the partner can interrogate any number on the dashboard back to its source signal.
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12
        }}
      >
        {stages.map((st, i) => (
          <div
            key={st.key}
            style={{
              padding: '14px 16px',
              background: 'var(--octave-n100)',
              border: '1px solid var(--octave-n300)',
              borderRadius: 'var(--radius-sm)',
              position: 'relative'
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 10,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--octave-text-muted)'
              }}
            >
              {String(i + 1).padStart(2, '0')} · {st.label}
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, marginTop: 4 }}>
              {st.value == null ? '—' : Number(st.value).toLocaleString()}
            </div>
            <div className="caption" style={{ marginTop: 4 }}>{st.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewCard({ eyebrow, title, bigStat, bigStatLabel, rows, footer }) {
  return (
    <div
      style={{
        padding: '16px 18px',
        background: 'var(--octave-n100)',
        border: '1px solid var(--octave-n300)',
        borderRadius: 'var(--radius-sm)'
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 11,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--octave-text-muted)',
          marginBottom: 6
        }}
      >
        {eyebrow}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, marginBottom: 12 }}>{title}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 30, color: 'var(--octave-accent)' }}>{bigStat}</span>
        <span className="caption">{bigStatLabel}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        {rows.map(r => (
          <div key={r.label} style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, fontSize: 13 }}>
            <span className="caption">{r.label}</span>
            <span>{r.value}</span>
          </div>
        ))}
      </div>
      {footer && (
        <div className="caption" style={{ fontStyle: 'italic', borderTop: '1px solid var(--octave-n300)', paddingTop: 10 }}>
          {footer}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="caption" style={{ fontSize: 11 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, marginTop: 2 }}>{value ?? '—'}</div>
    </div>
  );
}
