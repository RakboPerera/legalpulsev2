import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace } from '../components/WorkspaceContext.jsx';
import { workspaces as wsApi, pipeline as pipelineApi } from '../api.js';
import { Play, X, AlertCircle, Check, RefreshCw, ChevronDown } from 'lucide-react';
import { useTitle } from '../lib/useTitle.js';

// Source registry — display labels + a partner-facing one-line description.
// IDs must match backend/lib/sourcesConstants.js ALLOWED_SOURCES.
const SOURCES = [
  { id: 'tavily',              label: 'Tavily news search',     desc: 'Curated news search across global publications',     group: 'News' },
  { id: 'gdelt',               label: 'GDELT global news',      desc: 'Open global news events feed (no auth)',             group: 'News' },
  { id: 'edgar',               label: 'SEC EDGAR',              desc: 'US securities filings — 10-K, 10-Q, 8-K, S-1',        group: 'Filings' },
  { id: 'courtlistener',       label: 'CourtListener',          desc: 'US federal and state court dockets and opinions',     group: 'Filings' },
  { id: 'companies_house',     label: 'Companies House',        desc: 'UK company filings, officer changes, filings history',group: 'Filings' },
  { id: 'federal_register',    label: 'US Federal Register',    desc: 'US regulations and agency notices',                   group: 'Regulators' },
  { id: 'doj',                 label: 'US Department of Justice', desc: 'DOJ enforcement actions and press releases',        group: 'Regulators' },
  { id: 'ftc',                 label: 'US Federal Trade Commission', desc: 'FTC actions, settlements and consumer protection', group: 'Regulators' },
  { id: 'cftc',                label: 'US CFTC',                desc: 'Commodities and derivatives regulator actions',       group: 'Regulators' },
  { id: 'dg_comp',             label: 'EU DG COMP',             desc: 'European Commission competition decisions',           group: 'Regulators' },
  { id: 'fca',                 label: 'UK FCA',                 desc: 'Financial Conduct Authority enforcement and policy',  group: 'Regulators' },
  { id: 'fca_govuk',           label: 'UK FCA (gov.uk feed)',   desc: 'FCA notices via gov.uk Atom feed',                    group: 'Regulators' },
  { id: 'cma',                 label: 'UK CMA',                 desc: 'UK Competition and Markets Authority merger and antitrust', group: 'Regulators' },
  { id: 'ico_govuk',           label: 'UK ICO',                 desc: 'Information Commissioner — data protection enforcement', group: 'Regulators' },
  { id: 'ofcom',               label: 'UK Ofcom',               desc: 'Telecoms and broadcasting regulator',                 group: 'Regulators' },
  { id: 'bank_of_england',     label: 'Bank of England',        desc: 'PRA prudential enforcement and policy',               group: 'Regulators' },
  { id: 'hmt',                 label: 'HM Treasury',            desc: 'UK Treasury policy and consultations',                group: 'Regulators' },
  { id: 'fda_warning_letters', label: 'US FDA warning letters', desc: 'FDA enforcement letters to regulated companies',      group: 'Regulators' },
  { id: 'ofac_sdn',            label: 'US OFAC sanctions',      desc: 'Specially Designated Nationals (SDN) list',           group: 'Sanctions' },
  { id: 'eu_sanctions',        label: 'EU sanctions list',      desc: 'EU consolidated financial sanctions list',            group: 'Sanctions' },
  { id: 'uk_ofsi',             label: 'UK OFSI sanctions',      desc: 'UK Treasury financial sanctions list',                group: 'Sanctions' }
];

const ENGINES = [
  { id: 'cross_sell',         label: 'Cross-sell',          sub: 'Service gaps on existing clients vs. peer adoption' },
  { id: 'prospect_discovery', label: 'Prospect discovery',  sub: 'New-client opportunities surfaced from prospect signals' },
  { id: 'event_intelligence', label: 'Event intelligence',  sub: 'Time-sensitive market events affecting roster entities' }
];

const STAGE_LABEL = {
  ingest: 'Ingesting signals',
  classify: 'Classifying signals',
  engine: 'Running engines',
  brief: 'Drafting briefings',
  briefings: 'Drafting briefings',
  done: 'Complete'
};

export default function Sources() {
  useTitle('Signals & sources');
  const { currentId, refreshRuns } = useWorkspace();
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  const [selectedSources, setSelectedSources] = useState(new Set());
  const [selectedEngines, setSelectedEngines] = useState(new Set(['cross_sell', 'prospect_discovery', 'event_intelligence']));
  const [generateBriefings, setGenerateBriefings] = useState(true);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [runError, setRunError] = useState(null);

  // Aggregated progress (partner-readable, not a raw log)
  const [stage, setStage] = useState(null);
  const [progress, setProgress] = useState({ signalsIngested: 0, opportunities: 0, briefings: 0, briefingsFailed: 0, sourcesDone: 0 });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [logLines, setLogLines] = useState([]);
  const logEndRef = useRef(null);
  const runnerRef = useRef(null);

  useEffect(() => {
    if (!currentId) return;
    setError(null);
    wsApi.externalSources(currentId)
      .then(c => {
        setConfig(c);
        setSelectedSources(new Set(c?.enabledSources || []));
      })
      .catch(err => setError(err.response?.data?.message || err.response?.data?.error || err.message));
    wsApi.ingestionStatus(currentId).then(setStatus).catch(() => {});
  }, [currentId]);

  useEffect(() => {
    if (advancedOpen) logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [logLines.length, advancedOpen]);

  useEffect(() => () => runnerRef.current?.cancel(), []);

  const grouped = useMemo(() => {
    const out = new Map();
    for (const s of SOURCES) {
      if (!out.has(s.group)) out.set(s.group, []);
      out.get(s.group).push(s);
    }
    return out;
  }, []);

  const togglePipelineSource = src => {
    setSelectedSources(prev => {
      const next = new Set(prev);
      if (next.has(src)) next.delete(src); else next.add(src);
      return next;
    });
  };
  const togglePipelineEngine = eng => {
    setSelectedEngines(prev => {
      const next = new Set(prev);
      if (next.has(eng)) next.delete(eng); else next.add(eng);
      return next;
    });
  };
  const toggleGroup = (groupName, on) => {
    const ids = (grouped.get(groupName) || []).map(s => s.id);
    setSelectedSources(prev => {
      const next = new Set(prev);
      for (const id of ids) { if (on) next.add(id); else next.delete(id); }
      return next;
    });
  };

  const runPipeline = () => {
    if (running) return;
    setRunning(true);
    setRunResult(null);
    setRunError(null);
    setStage('starting');
    setProgress({ signalsIngested: 0, opportunities: 0, briefings: 0, briefingsFailed: 0, sourcesDone: 0 });
    setLogLines([]);

    runnerRef.current = pipelineApi.run(
      currentId,
      {
        sources: Array.from(selectedSources),
        engines: Array.from(selectedEngines),
        generateBriefings,
        briefingTopN: 20
      },
      {
        onLog: ({ line }) => setLogLines(prev => [...prev, line]),
        onProgress: data => {
          if (!data) return;
          if (data.stage) setStage(data.stage);
          setProgress(prev => {
            const next = { ...prev };
            if (data.stage === 'ingest' && typeof data.totalSignals === 'number') next.signalsIngested = data.totalSignals;
            if (data.stage === 'engine' && typeof data.gated === 'number') next.opportunities += data.gated;
            if (data.stage === 'briefings') {
              if (typeof data.briefed === 'number') next.briefings = data.briefed;
              if (typeof data.briefFails === 'number') next.briefingsFailed = data.briefFails;
            }
            if (data.stage === 'ingest' && typeof data.sourcesDone === 'number') next.sourcesDone = data.sourcesDone;
            return next;
          });
        },
        onDone: data => {
          setRunResult(data);
          setStage('done');
          setRunning(false);
          runnerRef.current = null;
          refreshRuns?.();
        },
        onError: data => {
          setRunError(data.message || data.error || 'Run failed.');
          setStage(null);
          setRunning(false);
          runnerRef.current = null;
        }
      }
    );
  };

  const cancelPipeline = () => {
    runnerRef.current?.cancel();
    setRunning(false);
    setStage(null);
  };

  const selectAll = () => setSelectedSources(new Set(SOURCES.map(s => s.id)));
  const clearAll = () => setSelectedSources(new Set());
  const nothingPicked = selectedSources.size === 0 && selectedEngines.size === 0;

  return (
    <div>
      <h1>Signals &amp; sources</h1>
      <p className="caption">
        Pick which intelligence sources to scan, which engines to run, and whether to generate
        partner-ready briefings. Each run replaces the current workspace data; the last five runs
        are retained.
      </p>

      {error && (
        <div className="banner-warn" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <AlertCircle size={14} /> Couldn’t load source configuration: {error}
        </div>
      )}

      {/* Status header */}
      <div className="entity-summary" style={{ marginBottom: 24 }}>
        <div className="kpi-tile">
          <div className="label">Signals on file</div>
          <div className="value">{status?.totalSignals ?? '—'}</div>
        </div>
        <div className="kpi-tile">
          <div className="label">Sources contributing</div>
          <div className="value">{Object.keys(status?.bySource || {}).length || '—'}</div>
        </div>
        <div className="kpi-tile">
          <div className="label">Last refreshed</div>
          <div className="value" style={{ fontSize: 14 }}>
            {status?.lastBakedAt ? new Date(status.lastBakedAt).toLocaleString() : '—'}
          </div>
        </div>
        <div className="kpi-tile">
          <div className="label">Selected for this run</div>
          <div className="value">{selectedSources.size}</div>
        </div>
      </div>

      {/* Source picker */}
      <div className="panel" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Sources to scan</h3>
          <div style={{ display: 'flex', gap: 12 }}>
            <button type="button" className="btn-link" onClick={selectAll}>Select all</button>
            <button type="button" className="btn-link" onClick={clearAll}>Clear</button>
          </div>
        </div>

        {[...grouped.entries()].map(([group, list]) => {
          const selectedInGroup = list.filter(s => selectedSources.has(s.id)).length;
          const allSelected = selectedInGroup === list.length;
          return (
            <div key={group} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--octave-text-muted)' }}>
                  {group} <span className="caption">· {selectedInGroup}/{list.length}</span>
                </div>
                <button type="button" className="btn-link" onClick={() => toggleGroup(group, !allSelected)}>
                  {allSelected ? 'Clear group' : 'Select group'}
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                {list.map(s => {
                  const signals = status?.bySource?.[s.id] || 0;
                  const contributed = status?.contributedToOpps?.[s.id] || 0;
                  // "Quiet" — feed not yet returning signals; "Monitoring" —
                  // signals coming in but nothing reaches an opportunity.
                  const tone = signals === 0 ? 'quiet'
                    : (contributed === 0 ? 'monitoring' : 'productive');
                  const toneLabel = tone === 'quiet'
                    ? 'Quiet (no signals yet)'
                    : tone === 'monitoring'
                      ? `Monitoring — ${signals} signal${signals === 1 ? '' : 's'}, no opps yet`
                      : `${signals} signal${signals === 1 ? '' : 's'} · ${contributed} opp${contributed === 1 ? '' : 's'}`;
                  const isSelected = selectedSources.has(s.id);
                  return (
                    <label
                      key={s.id}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                        padding: 10,
                        border: `1px solid ${isSelected ? 'var(--octave-accent)' : 'var(--octave-n700)'}`,
                        borderRadius: 'var(--radius-sm, 4px)', cursor: running ? 'not-allowed' : 'pointer',
                        background: isSelected ? 'var(--octave-panel-inset)' : 'transparent',
                        opacity: running ? 0.6 : 1
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedSources.has(s.id)}
                        onChange={() => togglePipelineSource(s.id)}
                        disabled={running}
                        style={{ marginTop: 2 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                          {s.label}
                          {tone === 'quiet' && <span className="src-tone src-tone-quiet" title="No signals received from this source yet — may be empty in your time window.">Quiet</span>}
                          {tone === 'monitoring' && <span className="src-tone src-tone-monitoring" title="Signals are arriving but none have been promoted into an opportunity yet — useful for monitoring rather than pipeline.">Monitoring</span>}
                        </div>
                        <div className="caption" style={{ marginTop: 2 }}>{s.desc}</div>
                        <div className="caption" style={{ marginTop: 2 }}>{toneLabel}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Engines + run */}
      <div className="panel" style={{ padding: 20, marginBottom: 20 }}>
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>Engines &amp; briefings</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10, marginBottom: 12 }}>
          {ENGINES.map(e => {
            const isSelected = selectedEngines.has(e.id);
            return (
            <label
              key={e.id}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: 12,
                border: `1px solid ${isSelected ? 'var(--octave-accent)' : 'var(--octave-n700)'}`,
                borderRadius: 'var(--radius-sm, 4px)', cursor: running ? 'not-allowed' : 'pointer',
                background: isSelected ? 'var(--octave-panel-inset)' : 'transparent',
                opacity: running ? 0.6 : 1
              }}
            >
              <input
                type="checkbox"
                checked={selectedEngines.has(e.id)}
                onChange={() => togglePipelineEngine(e.id)}
                disabled={running}
                style={{ marginTop: 2 }}
              />
              <div>
                <div style={{ fontWeight: 500, fontSize: 13 }}>{e.label}</div>
                <div className="caption" style={{ marginTop: 2 }}>{e.sub}</div>
              </div>
            </label>
            );
          })}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={generateBriefings}
            onChange={() => setGenerateBriefings(v => !v)}
            disabled={running}
          />
          <span>Draft partner-ready briefings for the top 20 opportunities (requires an LLM provider key).</span>
        </label>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18, flexWrap: 'wrap' }}>
          {!running ? (
            <button className="btn btn-accent" onClick={runPipeline} disabled={nothingPicked}>
              <Play size={14} /> Run
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={cancelPipeline}>
              <X size={14} /> Cancel
            </button>
          )}
          {!running && nothingPicked && (
            <span className="caption">Pick at least one source or engine before running.</span>
          )}
          {!running && !nothingPicked && (
            <CostEstimate
              sources={selectedSources.size}
              engines={selectedEngines.size}
              generateBriefings={generateBriefings}
            />
          )}
        </div>
      </div>

      {/* Progress / result panel */}
      {(running || runResult || runError || stage) && (
        <div className="panel" style={{ padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>
              {running ? (STAGE_LABEL[stage] || 'Running') + '…' : runError ? 'Run failed' : 'Run complete'}
            </h3>
            {running && <RefreshCw size={14} className="spin" />}
            {!running && runResult && <span className="audit-stat-good"><Check size={14} /> success</span>}
            {!running && runError && <span style={{ color: '#B33' }}><AlertCircle size={14} /> failed</span>}
          </div>

          {runError && (
            <div className="banner-warn" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <AlertCircle size={14} /> {runError}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <Stat label="Signals ingested" value={runResult?.signals ?? progress.signalsIngested} />
            <Stat label="Opportunities" value={runResult?.opportunities ?? progress.opportunities} />
            <Stat label="Briefings drafted" value={runResult?.briefings ?? progress.briefings}
                  sub={progress.briefingsFailed ? `${progress.briefingsFailed} failed` : null} />
            <Stat
              label="Duration"
              value={runResult?.durationMs ? `${Math.round(runResult.durationMs / 1000)}s` : (running ? '—' : '—')}
            />
          </div>

          {/* Advanced log: collapsed by default. Visible to anyone curious, hidden from partner gaze. */}
          <button
            type="button"
            className="btn-link"
            onClick={() => setAdvancedOpen(o => !o)}
            style={{ marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 4 }}
            aria-expanded={advancedOpen}
          >
            <ChevronDown size={14} style={{ transform: advancedOpen ? 'rotate(0)' : 'rotate(-90deg)', transition: 'transform 0.15s' }} />
            {advancedOpen ? 'Hide technical log' : 'Show technical log'}
          </button>
          {advancedOpen && (
            <div className="pipeline-log" style={{ marginTop: 8, maxHeight: 220 }}>
              {logLines.length === 0
                ? <div className="caption" style={{ padding: 8 }}>No log entries yet.</div>
                : logLines.map((line, i) => <div key={i} className="pipeline-log-line">{line}</div>)}
              <div ref={logEndRef} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CostEstimate({ sources, engines, generateBriefings }) {
  // Rough envelope, not a billing promise. The numbers are intentionally
  // conservative — partners would rather we under-promise on quota than
  // under-promise and then surprise them. Tuned from typical bake runs.
  const fetches = sources * 25;
  const classifyTokens = fetches * 600;
  const engineTokens = engines * 6500;
  const briefingTokens = generateBriefings ? 20 * 9000 : 0;
  const totalK = Math.round((classifyTokens + engineTokens + briefingTokens) / 1000);
  const usdLow = ((totalK * 1000 * 1.5) / 1_000_000).toFixed(2);
  const usdHigh = ((totalK * 1000 * 6) / 1_000_000).toFixed(2);
  return (
    <span className="caption" style={{ marginLeft: 4 }}>
      ≈ {totalK.toLocaleString()}k tokens · US$ {usdLow}–{usdHigh} on your provider quota.
    </span>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="audit-stat" style={{ minWidth: 0 }}>
      <div className="audit-stat-value">{value}</div>
      <div className="audit-stat-label">{label}</div>
      {sub && <div className="audit-stat-sub">{sub}</div>}
    </div>
  );
}
