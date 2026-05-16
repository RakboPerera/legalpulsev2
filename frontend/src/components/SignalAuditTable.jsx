import React, { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Search } from 'lucide-react';

// The Reasoning Trail's primary surface: a per-signal processing audit.
// Every signal in the deduped pool gets one row; the row tells the
// disposition (used-in-opp / significant-clustered-unused / significant-
// unclustered / flagged-noise) plus the per-stage trail when expanded.
//
// Filter chips drive a server-side query. Search is debounced to avoid
// hammering the endpoint on every keystroke.
//
// Props:
//   data        — the /reasoning response body
//   filters     — { source, disposition, entity, q }
//   onFilter    — (patch) => void  (updates filters; parent re-fetches)
//   onLoadMore  — (newOffset) => void
const DISPOSITION_LABELS = {
  'all': 'all',
  'used-in-opp': 'used in opp',
  'significant-clustered-unused': 'sig · clustered · unused',
  'significant-unclustered': 'sig · unclustered',
  'flagged-noise': 'flagged noise'
};
const DISPOSITION_ORDER = ['used-in-opp', 'significant-clustered-unused', 'significant-unclustered', 'flagged-noise'];

export default function SignalAuditTable({ data, filters, onFilter, onLoadMore }) {
  const [openId, setOpenId] = useState(null);
  const [searchDraft, setSearchDraft] = useState(filters.q || '');

  // Submit search on Enter or after a 500ms idle (debounce via blur is
  // enough — controlled input keeps draft local).
  const submitSearch = (e) => {
    if (e.key === 'Enter') onFilter({ q: searchDraft });
  };
  const clearSearch = () => { setSearchDraft(''); onFilter({ q: '' }); };

  const sourceFacet = Object.entries(data.facets?.bySource || {})
    .sort((a, b) => b[1] - a[1]);
  const dispositionFacet = data.facets?.byDisposition || {};
  const topEntityFacet = (data.facets?.byEntity || []).slice(0, 8);

  return (
    <div className="audit-table">
      {/* === Header strip: macro counts === */}
      <div className="audit-summary">
        <div className="audit-summary-row">
          <Stat label="Ingested" value={data.summary.ingested} />
          <span className="audit-arrow">→</span>
          <Stat label="Deduped" value={data.summary.deduped}
                sub={`−${data.summary.droppedDedup} duplicates`} />
          <span className="audit-arrow">→</span>
          <Stat label="Flagged significant" value={data.summary.flaggedSignificant}
                sub={`${data.summary.flaggedNoise} flagged noise`} />
          <span className="audit-arrow">→</span>
          <Stat label="In clusters" value={data.summary.clustered} />
          <span className="audit-arrow">→</span>
          <Stat label="Cited by an opp" value={data.summary.usedInOpp} variant="good" />
        </div>
      </div>

      {/* === Filter chips === */}
      <div className="audit-filters">
        <div className="audit-filter-row">
          <span className="audit-filter-label">Disposition:</span>
          <span
            className={`chip ${filters.disposition === 'all' ? 'active' : ''}`}
            onClick={() => onFilter({ disposition: 'all' })}
          >all</span>
          {DISPOSITION_ORDER.map(d => (
            <span
              key={d}
              className={`chip disp-chip disp-${d} ${filters.disposition === d ? 'active' : ''}`}
              onClick={() => onFilter({ disposition: d })}
            >
              {DISPOSITION_LABELS[d]} ({dispositionFacet[d] || 0})
            </span>
          ))}
        </div>

        <div className="audit-filter-row">
          <span className="audit-filter-label">Source:</span>
          <span
            className={`chip ${filters.source === 'all' ? 'active' : ''}`}
            onClick={() => onFilter({ source: 'all' })}
          >all</span>
          {sourceFacet.slice(0, 10).map(([src, n]) => (
            <span
              key={src}
              className={`chip ${filters.source === src ? 'active' : ''}`}
              onClick={() => onFilter({ source: src })}
            >{src} ({n})</span>
          ))}
        </div>

        {topEntityFacet.length > 0 && (
          <div className="audit-filter-row">
            <span className="audit-filter-label">Entity:</span>
            <span
              className={`chip ${filters.entity === 'all' ? 'active' : ''}`}
              onClick={() => onFilter({ entity: 'all' })}
            >all</span>
            {topEntityFacet.map(f => (
              <span
                key={f.id}
                className={`chip ${filters.entity === f.id ? 'active' : ''}`}
                onClick={() => onFilter({ entity: f.id })}
                title={f.name}
              >{f.name.slice(0, 22)} ({f.count})</span>
            ))}
          </div>
        )}

        <div className="audit-filter-row">
          <span className="audit-filter-label">Search:</span>
          <span className="audit-search">
            <Search size={14} />
            <input
              type="text"
              placeholder="title / excerpt"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              onKeyDown={submitSearch}
            />
            {searchDraft && <button type="button" onClick={clearSearch}>×</button>}
          </span>
          <span className="caption" style={{ marginLeft: 8 }}>
            (press Enter)
          </span>
        </div>
      </div>

      {/* === Table === */}
      <div className="audit-rows-head">
        <span className="audit-col-source">Source</span>
        <span className="audit-col-date">Date</span>
        <span className="audit-col-title">Title</span>
        <span className="audit-col-entities">Entities</span>
        <span className="audit-col-disposition">Disposition</span>
        <span className="audit-col-classifier">Classifier reason</span>
      </div>

      <div className="audit-rows">
        {data.signals.items.length === 0 ? (
          <div className="empty-state">No signals match these filters.</div>
        ) : (
          data.signals.items.map(sig => (
            <AuditRow
              key={sig.id}
              sig={sig}
              open={openId === sig.id}
              onToggle={() => setOpenId(openId === sig.id ? null : sig.id)}
            />
          ))
        )}
      </div>

      {/* === Pagination === */}
      <div className="audit-pagination">
        <span className="caption">
          Showing {data.signals.offset + 1}–{Math.min(data.signals.offset + data.signals.items.length, data.signals.total)} of {data.signals.total}
        </span>
        {data.signals.offset + data.signals.items.length < data.signals.total && (
          <button
            type="button"
            className="chip"
            onClick={() => onLoadMore(data.signals.offset + data.signals.limit)}
          >
            load next {Math.min(data.signals.limit, data.signals.total - data.signals.offset - data.signals.items.length)}
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, variant }) {
  return (
    <span className={`audit-stat audit-stat-${variant || 'default'}`}>
      <span className="audit-stat-value">{(value ?? 0).toLocaleString()}</span>
      <span className="audit-stat-label">{label}</span>
      {sub && <span className="audit-stat-sub">{sub}</span>}
    </span>
  );
}

function AuditRow({ sig, open, onToggle }) {
  const entityNames = sig.entities
    .map(e => e.entityName || e.mentionedAs)
    .filter(Boolean);
  return (
    <div className={`audit-row disp-${sig.disposition}`}>
      <button type="button" className="audit-row-summary" onClick={onToggle}>
        <span className="audit-col-source">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="chip" style={{ marginLeft: 4 }}>{sig.source}</span>
        </span>
        <span className="audit-col-date">{(sig.publishedAt || '').slice(0, 10)}</span>
        <span className="audit-col-title">{sig.title}</span>
        <span className="audit-col-entities caption">
          {entityNames.length ? entityNames.slice(0, 2).join(', ') + (entityNames.length > 2 ? ` +${entityNames.length - 2}` : '') : '—'}
        </span>
        <span className="audit-col-disposition">
          <span className={`chip disp-chip disp-${sig.disposition}`}>{DISPOSITION_LABELS[sig.disposition] || sig.disposition}</span>
        </span>
        <span className="audit-col-classifier caption">
          {sig.classification.reason || (sig.classification.isLegallySignificant ? 'significant' : 'noise')}
        </span>
      </button>

      {open && (
        <div className="audit-row-detail">
          {/* Processing trail — every stage's verdict on this signal */}

          <DetailStage n={1} label="Ingest" body={
            <>
              <div>Source: <strong>{sig.source}</strong>{sig.sourceUrl && (
                <> · <a href={sig.sourceUrl} target="_blank" rel="noreferrer">canonical link <ExternalLink size={11} /></a></>
              )}</div>
              <div>Published: {sig.publishedAt?.slice(0, 19).replace('T', ' ') || '—'}</div>
              <div>Fetched: {sig.ingestionTimestamp?.slice(0, 19).replace('T', ' ') || '—'}</div>
            </>
          } />

          <DetailStage n={2} label="Title + excerpt" body={
            <>
              <div className="audit-detail-title">{sig.title}</div>
              {sig.excerpt && <div className="caption audit-detail-excerpt">"{sig.excerpt}"</div>}
            </>
          } />

          <DetailStage n={3} label="Entity link" body={
            sig.entities.length ? (
              <ul className="audit-detail-list">
                {sig.entities.map((e, i) => (
                  <li key={i}>
                    <strong>{e.entityName || e.mentionedAs || '(unknown)'}</strong>
                    {e.entityId && <span className="caption"> ({e.entityId})</span>}
                    {typeof e.confidence === 'number' && <span className="caption"> · confidence {e.confidence.toFixed(2)}</span>}
                    {e.mentionedAs && e.entityName && e.mentionedAs !== e.entityName && (
                      <span className="caption"> · matched as "{e.mentionedAs}"</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : <div className="caption">No roster entities tagged.</div>
          } />

          <DetailStage n={4} label="Classify" body={
            <>
              <div>
                Verdict: <strong className={sig.classification.isLegallySignificant ? 'verdict-good' : 'verdict-weak'}>
                  {sig.classification.isLegallySignificant ? 'significant' : 'noise'}
                </strong>
                {sig.classification.classifiedBy && (
                  <span className="caption"> · by {sig.classification.classifiedBy}</span>
                )}
              </div>
              <div className="caption">Reason: {sig.classification.reason || '—'}</div>
              <div className="caption">
                Event topic: {sig.classification.eventTopic}
                {sig.classification.affectedIndustries?.length > 0 && (
                  <> · industries: {sig.classification.affectedIndustries.join(', ')}</>
                )}
              </div>
            </>
          } />

          <DetailStage n={5} label="Cluster" body={
            sig.cluster ? (
              <>
                <div>
                  Joined cluster <code>{sig.cluster.key}</code>
                </div>
                <div className="caption">
                  {sig.cluster.memberCount} member{sig.cluster.memberCount === 1 ? '' : 's'} ·
                  {' '}{sig.cluster.sourceCount} distinct source{sig.cluster.sourceCount === 1 ? '' : 's'}
                  {sig.cluster.jurisdictions?.length > 0 && (
                    <> · jurisdictions: {sig.cluster.jurisdictions.join(', ')}</>
                  )}
                </div>
                {sig.fusion.groupSize > 1 && (
                  <div className="caption">
                    Fusion: {sig.fusion.groupSize} corroborating signals across {sig.fusion.sourceCount} sources
                  </div>
                )}
              </>
            ) : (
              <div className="caption">
                Did not join a cluster — singleton ({sig.classification.isLegallySignificant
                  ? 'significant but uncorroborated'
                  : 'not significant, no clustering attempted'}).
              </div>
            )
          } />

          <DetailStage n={6} label="Opportunity contribution" body={
            sig.usedInOppIds.length ? (
              <div>
                Cited by <strong>{sig.usedInOppIds.length}</strong> opportunit{sig.usedInOppIds.length === 1 ? 'y' : 'ies'}:
                <ul className="audit-detail-list">
                  {sig.usedInOppIds.map(oid => (
                    <li key={oid}><code>{oid}</code></li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="caption">
                Not cited by any opportunity {sig.disposition === 'flagged-noise'
                  ? '(classifier excluded it from the opportunity pool)'
                  : sig.disposition === 'significant-unclustered'
                  ? '(no cluster formed around it)'
                  : '(in cluster, but no opp was composed from this cluster for this entity)'}.
              </div>
            )
          } />
        </div>
      )}
    </div>
  );
}

function DetailStage({ n, label, body }) {
  return (
    <section className="audit-detail-stage">
      <div className="audit-detail-stage-head">
        <span className="audit-detail-stage-num">{n}</span>
        <span className="audit-detail-stage-label">{label}</span>
      </div>
      <div className="audit-detail-stage-body">{body}</div>
    </section>
  );
}
