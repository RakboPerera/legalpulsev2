import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, Play, Pause, RotateCcw, ChevronRight,
  Search, Link2, Network, Scale, FileText, ShieldCheck,
  Database, Check
} from 'lucide-react';
import { useWorkspace } from './WorkspaceContext.jsx';
import { opportunities as oppApi } from '../api.js';

// Default numbers used when no workspace is loaded yet. The Overview reads
// live workspace counts via the WorkspaceContext when available — so a
// partner doesn't see stale marketing numbers that diverge from the actual
// sample data (e.g. "47 opportunities" rendered next to a 21-card board).
const BASELINE = { opportunities: 21, briefings: 21, signals: 605, sources: 17 };

/* =====================================================================
 * 1.  MANUAL vs LEGALPULSE — sharp two-card before/after
 * ===================================================================== */

const DELTA_ROWS = [
  { from: '4 hours',   to: '30 seconds', caption: 'Time per cycle' },
  { from: '1 client',  to: '23 entities', caption: 'Entities covered' },
  { from: '0% cited',  to: '100% cited',  caption: 'Evidence' }
];

function DeltaRail() {
  return (
    <div className="vs-delta-rail" aria-hidden="true">
      <div className="vs-delta-rail-tag">Δ</div>
      {DELTA_ROWS.map((d) => (
        <div className="vs-delta-row" key={d.caption}>
          <div className="vs-delta-from">{d.from}</div>
          <div className="vs-delta-arrow">→</div>
          <div className="vs-delta-to">{d.to}</div>
          <div className="vs-delta-caption">{d.caption}</div>
        </div>
      ))}
    </div>
  );
}

function ManualVsTool({ counts }) {
  const opps      = counts?.opportunities ?? BASELINE.opportunities;
  const briefings = counts?.briefings     ?? BASELINE.briefings;
  const entities  = counts?.entities      ?? 23;
  return (
    <div className="vs-block">
      <div className="vs-grid">
        <div className="vs-card vs-card-before">
          <div className="vs-card-tag">Before</div>
          <h3 className="vs-card-title">How a partner found opportunities.</h3>
          <p className="vs-card-pitch">Open tabs. Skim feeds. Cross-reference. Triangulate. Repeat for every client.</p>
          <ul className="vs-card-points">
            <li>Manually scan global news, securities filings, court dockets, sanctions lists</li>
            <li>Cross-reference legal commentary and regulator announcements</li>
            <li>Triangulate findings into a memo — for one client at a time</li>
          </ul>
          <div className="vs-card-foot">
            <div className="vs-card-foot-time">~4 hours</div>
            <div className="vs-card-foot-result">→ 1 partial memo · one client only · no citations</div>
          </div>
        </div>

        <DeltaRail />

        <div className="vs-card vs-card-after">
          <div className="vs-card-tag">Now — with LegalPulse</div>
          <h3 className="vs-card-title">How a partner gets opportunities.</h3>
          <p className="vs-card-pitch">Open the workspace. Every entity, every source, ranked and briefed before coffee.</p>
          <ul className="vs-card-points">
            <li>17 sources polled in parallel — every morning</li>
            <li>10 specialised agents — classify, link, map, brief, self-check</li>
            <li>Partner-ready briefings with cited sources and conflicts cleared</li>
          </ul>
          <div className="vs-card-foot">
            <div className="vs-card-foot-time">~30 seconds</div>
            <div className="vs-card-foot-result">
              → {opps} opportunities · {briefings} briefings · {entities} entities · cited sources
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =====================================================================
 * 2.  AGENTIC WORKFLOW — 4 stages, bespoke visualizations
 * ===================================================================== */

const SOURCE_GROUPS_VIZ = [
  { name: 'News',       items: ['GDELT', 'Lexology', 'JD Supra'] },
  { name: 'Filings',    items: ['SEC EDGAR', 'Companies House', 'Federal Register', 'EUR-Lex'] },
  { name: 'Courts',     items: ['CourtListener / PACER'] },
  { name: 'Sanctions',  items: ['OFAC SDN', 'EU Consolidated', 'UK OFSI'] },
  { name: 'Regulators', items: ['DOJ', 'FTC', 'FCA', 'DG COMP'] },
  { name: 'IP',         items: ['USPTO PatentsView'] }
];

/* Funnel now also carries the *dropped* count and the reason a signal was
   filtered out at each step — turns the visualization from "numbers shrinking"
   into a story of what got rejected and why. */
const FUNNEL_STEPS = [
  { count: 428, label: 'raw signals from 17 sources', width: '100%' },
  { count: 89,  label: 'legally significant',         width: '62%',
    rejected: 339, rejectionReason: 'Routine 10-Qs, analyst chatter, generic news — no legal trigger' },
  { count: 47,  label: 'matched to portfolio',        width: '34%',
    rejected: 42,  rejectionReason: 'Event mentions no Hartwell & Stone client or prospect' }
];

const MAP_INDUSTRIES = [
  { name: 'oil_gas',   conf: 95, needs: ['Force majeure clause review', 'Charterparty renegotiation'] },
  { name: 'shipping',  conf: 92, needs: ['Alternative-route contract drafting'] },
  { name: 'insurance', conf: 78, needs: ['War-risk insurance disputes'] }
];

/* Methodology Critic checks rendered alongside the briefing card so stage 4
   visually shows BOTH compose and self-check, not just the brief output. */
const METHODOLOGY_CHECKS = [
  { ok: true,  label: 'Citations grounded',     detail: '3 / 3 — Reuters, SEC 8-K, internal/matters' },
  { ok: true,  label: 'No cross-entity attribution', detail: 'No claims attributed across companies' },
  { ok: true,  label: 'No sanctions false positive', detail: 'OFAC / OFSI cross-check passed' },
  { ok: true,  label: 'Urgency matches recency', detail: 'Source dated 2026-05-05 → IMMEDIATE tag' }
];

const STAGES = [
  {
    id: 'ingest',
    num: '01',
    name: 'Ingest',
    Icon: Database,
    title: 'Listen to the world.',
    pitch: '17 public sources polled in parallel — news, filings, courts, sanctions, regulators. Real APIs, real signals.',
    visual: 'fan',
    flow: { from: '17 sources', to: '428 raw signals' },
    agents: [],
    why: 'Most BD platforms watch news only. We watch news + filings + courts + sanctions + regulators — so events show up before they’re reported.'
  },
  {
    id: 'classify',
    num: '02',
    name: 'Classify',
    Icon: Search,
    title: 'Decide what matters.',
    pitch: 'Filter the noise to the legally-significant few. Match each one to a known client or prospect.',
    visual: 'funnel',
    flow: { from: '428 signals', to: '47 matched events' },
    agents: [
      {
        Icon: Search,
        name: 'Signal Classifier',
        asks: 'Is this signal legally significant?',
        input:  { value: '428', label: 'raw signals from 17 sources' },
        output: { value: '89',  label: 'legally significant', handoff: 'Hands off to Entity Linker' },
        reasoning: 'Reads each signal with a senior-partner mental model: tags it on a curated taxonomy (M&A · sanctions · litigation · regulatory · IP · disclosure) and discards routine 10-Qs without litigation markers, analyst chatter, and speculation. Roughly 80% of raw signals are dropped here.',
        bpEvidence: [
          ['Reuters: "BP-flagged tankers transit Hormuz, May 5"'],
          ['Tags', 'regulatory · sanctions-adjacent · contract-risk'],
          ['Decision', 'legally significant · 0.97 confidence']
        ]
      },
      {
        Icon: Link2,
        name: 'Entity Linker',
        asks: 'Does this name a known client or prospect?',
        input:  { value: '89', label: 'significant signals' },
        output: { value: '47', label: 'matched to portfolio', handoff: 'Hands off to Industry Impact Mapper' },
        reasoning: 'Matches entity mentions against the firm’s client + prospect roster using exact alias + surface-form similarity, then assigns confidence. Refuses to invent matches — a substring like "BP" never matches a different oil major.',
        bpEvidence: [
          ['Mention in signal', '"BP plc"'],
          ['Matched', 'BP plc — Hartwell & Stone client'],
          ['Confidence', '1.00 (exact alias)']
        ]
      }
    ],
    why: '97% of news isn’t legally actionable. Without this filter, the partner inbox drowns.'
  },
  {
    id: 'map',
    num: '03',
    name: 'Map',
    Icon: Network,
    title: 'Translate event into work.',
    pitch: 'Tag each event with industries (with confidence) — then with the specific legal work that arises at the practice-area level.',
    visual: 'graph',
    flow: { from: '47 events', to: '180+ legal-need tags' },
    agents: [
      {
        Icon: Network,
        name: 'Industry Impact Mapper',
        asks: 'Which industries does this event affect?',
        input:  { value: '47', label: 'entity-matched events' },
        output: { value: '3', label: 'industries clearly hit', handoff: 'Hands off to Legal Needs Mapper' },
        reasoning: 'Tags each event with the industries clearly affected (not speculatively impacted), with a confidence score and a short rationale. Conservative threshold so the briefing reflects what’s defensible.',
        bpEvidence: [
          ['oil_gas',  '0.95 — BP’s core operating segment, direct exposure'],
          ['shipping', '0.92 — tanker routing forces alternative-charter activity'],
          ['insurance','0.78 — war-risk and hull policies likely re-priced']
        ]
      },
      {
        Icon: Scale,
        name: 'Legal Needs Mapper',
        asks: 'What specific legal work arises here?',
        input:  { value: '3', label: 'industries with confidence' },
        output: { value: '4', label: 'specific work-streams', handoff: 'Hands off to Briefing Generator' },
        reasoning: 'Translates industry + event-type into concrete work-streams keyed to the firm’s service taxonomy. Prefers specificity ("force majeure clause review") over generic advice ("litigation may be needed").',
        bpEvidence: [
          ['force_majeure_advisory', 'Charterparty force-majeure clause review'],
          ['contract_drafting',     'Alternative-route contract drafting'],
          ['ofac_advisory',         'War-risk insurance / sanctions overlay'],
          ['litigation_readiness',  'Demurrage and delay-claim posture']
        ]
      }
    ],
    why: 'An event rarely impacts one sector. Capturing the spread surfaces cross-sell to peer companies — and to your other clients in the same industry.'
  },
  {
    id: 'brief',
    num: '04',
    name: 'Brief',
    Icon: FileText,
    title: 'Compose, self-check, deliver.',
    pitch: 'Draft a partner-ready briefing — suggested partner, urgency, talking angles. Then self-check before surfacing.',
    visual: 'brief',
    flow: { from: '47 opportunities', to: '14 partner-ready briefings' },
    agents: [
      {
        Icon: FileText,
        name: 'Briefing Generator',
        asks: 'Compose the partner-ready briefing.',
        input:  { value: '47', label: 'mapped events + work-streams' },
        output: { value: '14', label: 'draft briefings', handoff: 'Hands off to Methodology Critic' },
        reasoning: 'Drafts a brief that cites only the underlying source (article, docket, filing date) — no fabrication. Surfaces three genuinely different talking angles, flags weakness if the signal is stale, and tags urgency from publication recency + competitive clock.',
        bpEvidence: [
          ['Subject',           'BP plc — Hormuz tanker exposure'],
          ['Suggested partner', 'James Hartwell QC (led BP Hormuz work, 2019)'],
          ['Urgency',           'IMMEDIATE'],
          ['Talking angles',    'commercial · regulatory · reputational']
        ]
      },
      {
        Icon: ShieldCheck,
        name: 'Methodology Critic',
        asks: 'Anything weak, overclaimed, or unsupported?',
        input:  { value: '14', label: 'draft briefings' },
        output: { value: '14', label: 'cleared for partner', handoff: 'Surfaces to the opportunity board' },
        reasoning: 'Audits the brief for soundness before it surfaces. Blocks on false cross-entity attribution, routine SEC filings dressed as triggers, sanctions false positives. Major flags on industry-wide signals used as entity-specific leads. Won’t clear weak recommendations with marketing polish.',
        bpEvidence: [
          ['Citations checked', '3 / 3 grounded — Reuters, SEC 8-K, internal/matters'],
          ['Cross-entity check','passed — no claims attributed across companies'],
          ['Verdict',           'CLEARED for surfacing']
        ]
      }
    ],
    why: 'Every claim cites the article or filing it came from. Nothing reaches the partner without passing the self-check.'
  }
];

const STEP_MS = 5200;

/* Signal-trace pills — render the SAME BP example as it accrues meaning across
   the four stages. Anchored to one running example so a first-time user sees the
   thread that links the four abstract stage visualizations together. */
const TRACE_STEPS = [
  { Icon: Database, label: 'Reuters · BP / Hormuz · May 5' },
  { Icon: Search,   label: 'significant · BP plc · 0.97' },
  { Icon: Network,  label: '3 industries · 4 legal needs' },
  { Icon: FileText, label: 'IMMEDIATE · Hartwell QC · cited' }
];

function SignalTrace({ active }) {
  return (
    <div className="wf-trace">
      <div className="wf-trace-label">Signal trace</div>
      <div className="wf-trace-items">
        {TRACE_STEPS.map((s, i) => {
          const state = i === active ? 'active' : i < active ? 'done' : 'pending';
          return (
            <React.Fragment key={i}>
              <div className={`wf-trace-item wf-trace-item-${state}`}>
                <s.Icon size={11} className="wf-trace-icon" />
                <span className="wf-trace-text">{s.label}</span>
              </div>
              {i < TRACE_STEPS.length - 1 && (
                <span className={`wf-trace-arrow wf-trace-arrow-${i < active ? 'done' : 'pending'}`}>→</span>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function Workflow({ onJumpToDemo }) {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [expandedAgent, setExpandedAgent] = useState(null);
  const tickRef = useRef(null);

  // Auto-advance is paused while the user is reading an expanded agent.
  useEffect(() => {
    if (!playing) return;
    if (expandedAgent) return;
    tickRef.current = setInterval(() => {
      setActive(a => (a + 1) % STAGES.length);
    }, STEP_MS);
    return () => clearInterval(tickRef.current);
  }, [playing, expandedAgent]);

  // Switching stages closes whatever was expanded — fresh slate per stage.
  useEffect(() => { setExpandedAgent(null); }, [active]);

  const goto = (i) => { setActive(i); setPlaying(false); };
  const next = () => { setActive(a => (a + 1) % STAGES.length); setPlaying(false); };
  const prev = () => { setActive(a => (a - 1 + STAGES.length) % STAGES.length); setPlaying(false); };
  const restart = () => { setActive(0); setPlaying(true); setExpandedAgent(null); };
  const toggleAgent = (name) => {
    setExpandedAgent(curr => (curr === name ? null : name));
    setPlaying(false);
  };

  const stage = STAGES[active];
  const progressPct = ((active + 1) / STAGES.length) * 100;

  return (
    <div className="wf">
      {/* Stepper rail with 4 big numbered circles */}
      <div className="wf-rail" role="tablist" aria-label="Pipeline stages">
        <div className="wf-rail-progress">
          <div className="wf-rail-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
        {STAGES.map((s, i) => {
          const state = i === active ? 'active' : i < active ? 'done' : 'pending';
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={state === 'active'}
              className={`wf-step wf-step-${state}`}
              onClick={() => goto(i)}
              title={s.name}
            >
              <span className="wf-step-circle">
                <s.Icon size={20} />
                <span className="wf-step-num">{s.num}</span>
              </span>
              <span className="wf-step-name">{s.name}</span>
              <span className="wf-step-title">{s.title}</span>
            </button>
          );
        })}
      </div>

      {/* Player controls */}
      <div className="wf-controls">
        <button className="btn-icon-mini" onClick={prev} title="Previous">
          <ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} />
        </button>
        {playing
          ? <button className="btn-icon-mini" onClick={() => setPlaying(false)} title="Pause"><Pause size={14} /></button>
          : <button className="btn-icon-mini" onClick={() => setPlaying(true)} title="Play"><Play size={14} /></button>}
        <button className="btn-icon-mini" onClick={next} title="Next">
          <ChevronRight size={14} />
        </button>
        <button className="btn-icon-mini" onClick={restart} title="Restart"><RotateCcw size={14} /></button>
        <span className="wf-controls-meta">
          Stage <strong>{active + 1}</strong> of {STAGES.length}
        </span>
      </div>

      {/* Stage panel — compact: head row with inline flow chip, then viz+agents side-by-side */}
      <div className="wf-panel" key={active}>
        <div className="wf-panel-head">
          <div className="wf-panel-head-text">
            <div className="wf-panel-eyebrow">{stage.num} / {stage.name}</div>
            <h3 className="wf-panel-title">{stage.title}</h3>
            <p className="wf-panel-sub">{stage.pitch}</p>
          </div>
          <div className="wf-flow-chip" title={`${stage.flow.from} in → ${stage.flow.to} out`}>
            <span className="wf-flow-chip-from">{stage.flow.from}</span>
            <ChevronRight size={12} className="wf-flow-chip-arrow" />
            <span className="wf-flow-chip-to">{stage.flow.to}</span>
          </div>
        </div>

        {/* Trace strip — the SAME BP signal accruing meaning across the 4 stages.
            This is the narrative thread that ties the abstract stage visuals together
            for a first-time viewer. */}
        <SignalTrace active={active} />

        <div className={`wf-body ${stage.agents.length === 0 ? 'wf-body-solo' : ''}`}>
          {stage.agents.length > 0 && (
            <section className="wf-agents-strip" aria-label={`${stage.agents.length} agents running`}>
              <header className="wf-agents-strip-head">
                <span className="wf-agents-pulse" />
                <span className="wf-agents-head-label">
                  {stage.agents.length} agents · click to inspect
                </span>
              </header>
              <div className="wf-agents-list">
                {stage.agents.map((a, i) => (
                  <AgentAccordion
                    key={a.name}
                    agent={a}
                    index={i}
                    expanded={expandedAgent === a.name}
                    onToggle={() => toggleAgent(a.name)}
                  />
                ))}
              </div>
            </section>
          )}

          <div className={`wf-stage-output ${stage.agents.length === 0 ? 'wf-stage-output-solo' : ''}`}>
            {stage.agents.length > 0 && (
              <div className="wf-stage-output-label">Stage produced</div>
            )}
            <div className="wf-stage-output-body">
              <StageViz visual={stage.visual} stage={stage} />
            </div>
          </div>
        </div>

        <div className="wf-why">
          <span className="wf-why-label">Why</span>
          <span className="wf-why-body">{stage.why}</span>
          {active === STAGES.length - 1 && (
            <button className="btn btn-accent btn-sm wf-cta" onClick={onJumpToDemo}>
              See the live briefing <ArrowRight size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentAccordion({ agent, index, expanded, onToggle }) {
  const { Icon, name, asks, input, output, reasoning, bpEvidence } = agent;
  return (
    <div
      className={`wf-agent-card ${expanded ? 'wf-agent-card-expanded' : ''}`}
      style={{ animationDelay: `${index * 120}ms` }}
    >
      <button
        type="button"
        className="wf-agent-card-head"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <div className="wf-agent-card-icon">
          <Icon size={16} />
          <span className="wf-agent-icon-ring" aria-hidden />
        </div>
        <div className="wf-agent-card-text">
          <div className="wf-agent-card-name">{name}</div>
          <div className="wf-agent-card-asks">“{asks}”</div>
        </div>
        <div className="wf-agent-card-meta">
          <span className="wf-agent-card-throughput">
            <span className="wf-agent-card-throughput-from">{input.value}</span>
            <span className="wf-agent-card-throughput-arrow">→</span>
            <span className="wf-agent-card-throughput-to">{output.value}</span>
          </span>
          <ChevronRight
            size={16}
            className={`wf-agent-card-chevron ${expanded ? 'wf-agent-card-chevron-open' : ''}`}
          />
        </div>
      </button>

      {expanded && (
        <div className="wf-agent-card-detail">
          <div className="wf-agent-detail-grid">
            <section className="wf-agent-detail-block wf-agent-detail-input">
              <div className="wf-agent-detail-label">Input</div>
              <div className="wf-agent-detail-value">
                <span className="wf-agent-detail-num">{input.value}</span>
                <span className="wf-agent-detail-num-label">{input.label}</span>
              </div>
            </section>

            <section className="wf-agent-detail-block wf-agent-detail-output">
              <div className="wf-agent-detail-label">
                <Check size={12} className="wf-agent-detail-check" />
                Output
              </div>
              <div className="wf-agent-detail-value">
                <span className="wf-agent-detail-num">{output.value}</span>
                <span className="wf-agent-detail-num-label">{output.label}</span>
              </div>
              {output.handoff && (
                <div className="wf-agent-detail-handoff">{output.handoff}</div>
              )}
            </section>
          </div>

          <section className="wf-agent-detail-block wf-agent-detail-reasoning">
            <div className="wf-agent-detail-label">How it decides</div>
            <p className="wf-agent-detail-prose">{reasoning}</p>
          </section>

          <section className="wf-agent-detail-block wf-agent-detail-evidence">
            <div className="wf-agent-detail-label">For the BP / Hormuz signal</div>
            <ul className="wf-agent-evidence-list">
              {bpEvidence.map((row, i) => (
                <li key={i} className="wf-agent-evidence-row">
                  {row.length === 1 ? (
                    <span className="wf-agent-evidence-solo">{row[0]}</span>
                  ) : (
                    <>
                      <span className="wf-agent-evidence-key">{row[0]}</span>
                      <span className="wf-agent-evidence-val">{row[1]}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}

function StageViz({ visual, stage }) {
  if (visual === 'fan') return <VizFan />;
  if (visual === 'funnel') return <VizFunnel />;
  if (visual === 'graph') return <VizGraph />;
  if (visual === 'brief') return <VizBrief />;
  return null;
}

function VizFan() {
  return (
    <div className="viz-fan">
      <div className="viz-fan-sources">
        {SOURCE_GROUPS_VIZ.map((g, i) => (
          <div className="viz-fan-group" key={g.name} style={{ animationDelay: `${i * 80}ms` }}>
            <div className="viz-fan-group-head">{g.name}</div>
            <div className="viz-fan-chips">
              {g.items.map(it => <span className="viz-fan-chip" key={it}>{it}</span>)}
            </div>
            <span className="viz-fan-line" aria-hidden />
          </div>
        ))}
      </div>
      <div className="viz-fan-hub">
        <div className="viz-fan-hub-pulse" />
        <div className="viz-fan-hub-pulse viz-fan-hub-pulse-2" />
        <div className="viz-fan-hub-core">
          <Database size={22} />
        </div>
        <div className="viz-fan-hub-counter">428</div>
        <div className="viz-fan-hub-sub">raw signals / day</div>
      </div>
    </div>
  );
}

function VizFunnel() {
  return (
    <div className="viz-funnel">
      {FUNNEL_STEPS.map((s, i) => (
        <React.Fragment key={i}>
          {s.rejected != null && (
            <div className="viz-funnel-drop" style={{ animationDelay: `${i * 220 - 60}ms` }}>
              <span className="viz-funnel-drop-icon" aria-hidden>↓</span>
              <span className="viz-funnel-drop-count">−{s.rejected}</span>
              <span className="viz-funnel-drop-reason">{s.rejectionReason}</span>
            </div>
          )}
          <div className="viz-funnel-row">
            <div
              className={`viz-funnel-bar ${i === 0 ? 'viz-funnel-bar-raw' : ''}`}
              style={{ width: s.width, animationDelay: `${i * 220}ms` }}
            >
              <span className="viz-funnel-count">{s.count}</span>
              <span className="viz-funnel-label">{s.label}</span>
            </div>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

function VizGraph() {
  return (
    <div className="viz-graph">
      {/* Event sits at the top of the fan; lines diverge down to industries */}
      <div className="viz-graph-event">
        <div className="viz-graph-event-label">EVENT</div>
        <div className="viz-graph-event-name">BP plc — Hormuz transit</div>
      </div>

      <svg className="viz-graph-fan" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
        {/* Three branch paths from a single point at top-center to evenly
            spaced anchor points along the bottom (10%, 50%, 90%). */}
        <path d="M 50 0 Q 50 15 10 30" />
        <path d="M 50 0 L 50 30" />
        <path d="M 50 0 Q 50 15 90 30" />
      </svg>

      <div className="viz-graph-industries">
        {MAP_INDUSTRIES.map((ind, i) => (
          <div className="viz-graph-industry-card" key={ind.name} style={{ animationDelay: `${i * 140}ms` }}>
            <div className="viz-graph-industry-head">
              <span className="viz-graph-industry-name">{ind.name}</span>
              <span className="viz-graph-industry-conf">{ind.conf}%</span>
            </div>
            <div className="viz-graph-industry-meter">
              <div className="viz-graph-industry-fill" style={{ width: `${ind.conf}%` }} />
            </div>
            <ul className="viz-graph-needs">
              {ind.needs.map(n => <li key={n}>{n}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function VizBrief() {
  return (
    <div className="viz-brief">
      <div className="viz-brief-card">
        <div className="viz-brief-letterhead">PARTNER BRIEFING · IMMEDIATE</div>
        <div className="viz-brief-line">
          <span className="viz-brief-key">Subject</span>
          <span className="viz-brief-val">BP plc — Hormuz tanker exposure</span>
        </div>
        <div className="viz-brief-line">
          <span className="viz-brief-key">Suggested partner</span>
          <span className="viz-brief-val">James Hartwell QC <span className="viz-brief-hint">(Led BP Hormuz work in 2019)</span></span>
        </div>
        <div className="viz-brief-line">
          <span className="viz-brief-key">Talking angles</span>
          <span className="viz-brief-val">commercial · regulatory · reputational</span>
        </div>
        <div className="viz-brief-body">
          12 BP-flagged vessels are transiting the Strait of Hormuz<sup className="viz-brief-cite">[1]</sup>. The 8-K filed May 4 confirms exposure<sup className="viz-brief-cite">[2]</sup>. Force majeure provisions and war-risk insurance disputes are likely.
        </div>
        <div className="viz-brief-citations">
          [1] reuters.com / 2026-05-05 &nbsp;·&nbsp; [2] sec.gov/edgar/8-K / 2026-05-04 &nbsp;·&nbsp; [3] internal/matters
        </div>
      </div>

      {/* Methodology Critic checklist — shows the self-check ticking through
          the audit. The CLEARED stamp at the bottom replaces the old stamp
          that was floating on the briefing card. */}
      <aside className="viz-brief-audit" aria-label="Methodology Critic self-check">
        <div className="viz-brief-audit-head">
          <ShieldCheck size={14} className="viz-brief-audit-head-icon" />
          <span>Methodology self-check</span>
        </div>
        <ul className="viz-brief-audit-list">
          {METHODOLOGY_CHECKS.map((c, i) => (
            <li key={c.label} className="viz-brief-audit-item" style={{ animationDelay: `${i * 180}ms` }}>
              <Check size={12} className="viz-brief-audit-check" />
              <div className="viz-brief-audit-text">
                <div className="viz-brief-audit-label">{c.label}</div>
                <div className="viz-brief-audit-detail">{c.detail}</div>
              </div>
            </li>
          ))}
        </ul>
        <div className="viz-brief-audit-stamp">
          CLEARED <ShieldCheck size={12} />
        </div>
      </aside>
    </div>
  );
}

/* =====================================================================
 * 3.  THE SOURCES TABLE — grouped by area, with purpose
 * ===================================================================== */

const SOURCE_GROUPS = [
  {
    area: 'News & Open Web',
    rows: [
      ['GDELT Project', 'Real-time global news event database', 'Catches event-driven signals on every named client and prospect — the primary feed.'],
      ['Lexology (RSS)', 'Curated practice-area legal commentary', 'Picks up emerging legal themes earlier than mainstream news.'],
      ['JD Supra (RSS)', 'Lawyer-authored client alerts', 'Surfaces what other firms are already advising clients on.']
    ]
  },
  {
    area: 'Government Filings & Disclosures',
    rows: [
      ['SEC EDGAR', 'Mandatory US public-company filings (8-K, 10-Q, 10-K, DEF 14A)', 'Material events — M&A, restatements, leadership change, litigation disclosure — straight from the company.'],
      ['Companies House', 'Statutory UK company filings & officers', 'UK subsidiaries, directorship changes, charges — companion to EDGAR.'],
      ['Federal Register', 'US executive-branch rulemaking', 'New rules and proposed rules that create regulatory work.'],
      ['EUR-Lex (RSS)', 'EU legislation & case law', 'Tracks EU directive and regulation pipeline.']
    ]
  },
  {
    area: 'Court Records',
    rows: [
      ['CourtListener / PACER', 'US federal & state court dockets', 'New filings against / by clients, motion-level visibility, ongoing litigation that drives mandates.']
    ]
  },
  {
    area: 'Sanctions & Compliance',
    rows: [
      ['OFAC SDN list', 'US Treasury sanctions designations', 'Conflict-blocking input + cross-reference for clients\' counterparties.'],
      ['EU Consolidated Sanctions', 'EU Council restrictive measures', 'EU jurisdictional check, used alongside OFAC and OFSI.'],
      ['UK OFSI', 'HM Treasury financial sanctions', 'UK jurisdictional check for the same risk surface.']
    ]
  },
  {
    area: 'Regulatory Enforcement',
    rows: [
      ['DOJ press releases (RSS)', 'US Department of Justice announcements', 'Indictments, settlements, monitorships — high-signal mandate triggers.'],
      ['FTC press releases (RSS)', 'US antitrust + consumer protection', 'Merger challenges, consent decrees, investigations.'],
      ['FCA news (RSS)', 'UK Financial Conduct Authority', 'UK financial-services enforcement and policy.'],
      ['DG COMP (RSS)', 'EU Directorate-General for Competition', 'EU merger reviews, antitrust decisions, state-aid rulings.']
    ]
  },
  {
    area: 'IP & Innovation',
    rows: [
      ['USPTO PatentsView', 'US Patent & Trademark Office data', 'Patent grants and disputes that signal IP litigation or transactional work.']
    ]
  }
];

function SourcesTable() {
  return (
    <div className="src-table-wrap">
      <table className="src-table">
        <thead>
          <tr>
            <th className="src-th-area">Area</th>
            <th className="src-th-source">Source</th>
            <th className="src-th-what">What it is</th>
            <th className="src-th-why">Why we use it</th>
          </tr>
        </thead>
        <tbody>
          {SOURCE_GROUPS.map(g => g.rows.map((row, i) => (
            <tr key={`${g.area}-${i}`} className={i === 0 ? 'src-row-first' : 'src-row'}>
              {i === 0 ? (
                <td className="src-td-area" rowSpan={g.rows.length}>
                  <span className="src-area-label">{g.area}</span>
                  <span className="src-area-count">{g.rows.length}</span>
                </td>
              ) : null}
              <td className="src-td-source">{row[0]}</td>
              <td className="src-td-what">{row[1]}</td>
              <td className="src-td-why">{row[2]}</td>
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}

/* =====================================================================
 * 4.  PAGE
 * ===================================================================== */

export default function OverviewContent({ variant = 'standalone' }) {
  const { list, current, currentId, createWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [opps, setOpps] = useState(null);

  const sourceWorkspace = current || list.find(w => w.mode === 'demo') || null;
  const sourceId = sourceWorkspace?.id || null;
  const isEmbedded = variant === 'embedded';

  useEffect(() => {
    if (!sourceId) { setOpps(null); return; }
    let cancelled = false;
    oppApi.list(sourceId, { limit: 500 })
      .then(r => { if (!cancelled) setOpps(r.opportunities || []); })
      .catch(() => { if (!cancelled) setOpps(null); });
    return () => { cancelled = true; };
  }, [sourceId]);

  const stats = useMemo(() => {
    if (opps && opps.length) {
      return {
        opportunities: opps.length,
        briefings: opps.filter(o => o.hasBriefing).length,
        signals: sourceWorkspace?.counts?.signals ?? BASELINE.signals,
        sources: BASELINE.sources,
        bakedAt: sourceWorkspace?.bakedAt
      };
    }
    return { ...BASELINE, bakedAt: sourceWorkspace?.bakedAt || null };
  }, [opps, sourceWorkspace]);

  const existingDemo = (list || []).find(w => w.mode === 'demo');

  const primaryCta = async () => {
    if (isEmbedded && currentId) { navigate(`/workspaces/${currentId}`); return; }
    setBusy(true);
    try {
      if (existingDemo) { navigate(`/workspaces/${existingDemo.id}`); return; }
      const ws = await createWorkspace({ mode: 'demo' });
      navigate(`/workspaces/${ws.id}`);
    } finally { setBusy(false); }
  };

  const ctaLabel = isEmbedded
    ? 'Go to the opportunity board'
    : (existingDemo ? 'Continue to demo' : 'Open the demo');

  const bakedLabel = stats.bakedAt
    ? new Date(stats.bakedAt).toISOString().slice(0, 10)
    : '2026-05-12';

  const wrapperClass = isEmbedded ? 'overview overview-embedded' : 'overview overview-standalone landing';

  return (
    <div className={wrapperClass}>
      {!isEmbedded && (
        <header className="landing-nav">
          <div className="landing-brand">
            <span className="landing-product landing-product-solo">LegalPulse</span>
          </div>
          <nav className="landing-nav-links">
            <a href="#compare">Before vs. now</a>
            <a href="#workflow">How it works</a>
            <a href="#sources">Data sources</a>
          </nav>
        </header>
      )}

      {/* === HERO — succinct === */}
      <section className={isEmbedded ? 'overview-hero-embed' : 'landing-hero'}>
        <div className="landing-container">
          <div className="overview-pulse-badge">
            <span className="pulse-dot" />
            <span>Live · {sourceWorkspace?.firmProfile?.name || 'your firm'}</span>
          </div>
          <h1 className={isEmbedded ? 'overview-headline-embed' : 'landing-headline'}>
            Hours of partner research,<br />delivered as <span className="accent-word">ranked opportunities</span> every morning.
          </h1>
          <p className="landing-subhead overview-subhead-tight">
            Every public-source signal, ranked and briefed for the partner before coffee.
          </p>

          <div className="landing-cta-row">
            <button className="btn btn-accent btn-lg" onClick={primaryCta} disabled={busy}>
              {ctaLabel} <ArrowRight size={16} />
            </button>
            <span className="landing-cta-caption">
              {isEmbedded
                ? `Live from ${sourceWorkspace?.name || 'this workspace'} · baked ${bakedLabel}`
                : 'No signup. The pre-baked demo opens instantly.'}
            </span>
          </div>
        </div>
      </section>

      {/* === BEFORE vs NOW — simple, side-by-side === */}
      <section id="compare" className="landing-section overview-section-tight">
        <div className="landing-container">
          <div className="overview-tag">Before vs. now</div>
          <h2 className="landing-section-h2">
            Same question. <span className="accent-word">Two worlds.</span>
          </h2>
          <p className="landing-section-lead">
            On the left: the way it’s done today. On the right: the same job, with LegalPulse.
          </p>
          <ManualVsTool counts={sourceWorkspace?.counts} />
        </div>
      </section>

      {/* === AGENTIC WORKFLOW (4 stages, bespoke visuals) === */}
      <section id="workflow" className="landing-section overview-section-dark">
        <div className="landing-container">
          <div className="overview-tag overview-tag-on-panel">The agentic workflow</div>
          <h2 className="overview-section-h2-on-panel">
            Watch one signal — a Reuters article on <span className="accent-word">BP plc</span> —<br />
            become a partner-ready briefing.
          </h2>
          <p className="overview-section-lead-on-panel">
            Four stages, one running example. Step through each stage to follow the BP signal as it accumulates meaning — then click any agent to see what it actually decides.
          </p>
          <Workflow onJumpToDemo={primaryCta} />
        </div>
      </section>

      {/* === SOURCES TABLE === */}
      <section id="sources" className="landing-section">
        <div className="landing-container">
          <div className="overview-tag">External data</div>
          <h2 className="landing-section-h2">
            17 public sources. <span className="accent-word">No paywalled feeds.</span>
          </h2>
          <p className="landing-section-lead">
            Every recommendation cites one of these. Grouped by what they cover — with what each is, and why it’s in the pipeline.
          </p>
          <SourcesTable />
        </div>
      </section>

      {/* === FOOTER (slim CTA) === */}
      <footer className={isEmbedded ? 'overview-close-embed' : 'landing-footer'}>
        <div className="landing-container">
          <div className="landing-footer-inner">
            <div>
              <div className="landing-footer-headline">
                {isEmbedded ? 'Open the opportunity board.' : 'Open the demo.'}
              </div>
              <p className="landing-footer-caption">
                Hartwell &amp; Stone LLP is fictional. The 15 clients and 8 prospects are real public companies; their signals are real.
              </p>
            </div>
            <div className="landing-footer-cta">
              <button className="btn btn-accent btn-lg" onClick={primaryCta} disabled={busy}>
                {ctaLabel} <ArrowRight size={16} />
              </button>
            </div>
          </div>
          <div className="landing-footer-bottom">
            <span className="landing-footer-brand">LegalPulse</span>
            <span className="landing-footer-meta">Agentic BD intelligence for legal teams.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
