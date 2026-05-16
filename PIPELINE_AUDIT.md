# LegalPulse data pipeline audit (2026-05-13, post-v7 bake)

Where opportunities come from, end-to-end, and what's broken at each stage.

```
INGEST → DEDUP → ENTITY-LINK → CLASSIFY → FUSE → CLUSTER → SCREEN → COMPOSE → CRITIC → BRIEF
```

---

## Stage 1 — Ingestion (sources)

### What it does
Eight sources contribute to the workspace's signal pool. v7 baked stats:
| Source | Signals | Notes |
|---|---|---|
| Tavily | 245 | Primary news (entity + theme queries) |
| EDGAR | 107 | SEC filings per CIK |
| Federal Register | 18 | US rulemakings |
| FCA | 20 | UK regulator RSS |
| CMA | 20 | UK competition RSS |
| OFAC SDN | 10 | Sanctions cross-ref hits |
| CourtListener | 0 | Token not configured |
| Companies House | 0 | Token not configured |

### Issues

**[HIGH] Two of eight sources are silent.** `COURTLISTENER_API_TOKEN` and `COMPANIES_HOUSE_API_KEY` are empty in [backend/.env](backend/.env). CourtListener is the only litigation source — without it we can't see actual lawsuits filed, only news *about* lawsuits. Companies House would surface UK officer changes (incoming GCs are a buying signal). **Fix:** request keys; both have free tiers (CourtListener at courtlistener.com/api/, Companies House at developer.company-information.service.gov.uk/).

**[HIGH] Six of twelve RSS feeds return 404 / format errors silently** (DOJ, FTC, DG COMP, Lexology, JD Supra, NY AG, CA AG, EPA, ICO, CFTC, FDA Warning Letters). [backend/sources/rssSources.js](backend/sources/rssSources.js) defines them; orchestrator skips on failure. We're effectively running on Tavily + EDGAR + 3 RSS feeds. **Fix:** repair URLs (some have moved), add per-feed health logging in `[scripts/bake-demo.js:330ish]`, surface broken sources in `data/bake-summary.json` so it's visible.

**[MEDIUM] No source for global market data (commodity prices, FX, equity moves).** A 10% drop in a client's stock price is a strong "competitive distress" signal that creates restructuring / governance work — we have no feed for it. **Fix:** add Yahoo Finance / Alpha Vantage adapter under `backend/sources/marketData.js` for one-line per-entity quote pulls.

**[LOW] Source rate limits in [backend/lib/http.js:13](backend/lib/http.js#L13) are static guesses.** Tavily set to 10 RPS without verifying their actual limit. Under heavier bakes we'd 429.

---

## Stage 2 — Deduplication

### What it does
[backend/lib/dedupe.js](backend/lib/dedupe.js) drops signals with the same `id` (deterministic hash of source + URL).

### Issues

**[MEDIUM] Same-content cross-source dupes survive.** v7 has 19 same-title groups — examples include 13 distinct EDGAR signals all titled "6-K filing — HSBC Holdings plc" (legitimately different filings on different dates) BUT also potential Tavily/GDELT pairs of the same article when both fetchers ran for the same entity. Current dedupe only catches identical IDs. **Fix:** add a content-based dedupe pass: same title + same publishedAt-day collapses to one record, preferring the source with richer description.

**[LOW] URL canonicalization is naive.** Same article reachable at `?utm_source=newsletter` and the bare URL would dedupe to two records. **Fix:** strip UTM/fbclid/etc. query params and trailing slashes before hashing in [backend/lib/ids.js:12](backend/lib/ids.js#L12).

---

## Stage 3 — Entity linking

### What it does
Two-pass:
1. Fetcher pre-tags signals at confidence 0.85–1.0 (e.g., GDELT entity-search → tag with queried entity).
2. [scripts/bake-demo.js:316](scripts/bake-demo.js#L316) `deepLinkEntities()` re-runs word-boundary regex on title + description for "unreliable pretag sources" (gdelt, tavily, fca, federal_register, etc.). [backend/lib/entities.js:48](backend/lib/entities.js#L48) `linkEntities()` does the regex.

### Issues

**[HIGH] EventScreener still shows over-extrapolation despite re-linking** — v7 had ~30 cross-entity false-attribution drops at the critic stage. Pattern: a Tavily theme cluster contains 80 signals about various entities; deep-linking correctly tags ALL the named entities, but when the screener LLM sees "this cluster has [BP, Maersk, HSBC, Apple, Volkswagen] mentioned" it overreaches and proposes exposures for ALL of them. The signals supporting any single entity are weak.

**Root cause:** event clusters mix content. The screener treats "any entity tagged in any signal in the cluster" as exposed, when really only entities tagged in MULTIPLE signals or in the cluster's primary signal are credibly affected.

**Fix:** in [backend/agents/eventScreener.js](backend/agents/eventScreener.js), pre-filter the roster passed to the LLM: only include entities mentioned in ≥2 signals of the cluster, OR in the top-fusion-cluster signal. Reduces cross-entity false attributions from ~50% to <20%.

**[HIGH] "general event" topic captures 56% of signals** (236/420 in v7). The classifier in [scripts/bake-helpers.js:146](scripts/bake-helpers.js#L146) `deriveEventTopic()` returns "general event" when no SERVICE_FROM_SIGNAL regex matches. So a cluster on "general_event::2026-W18" had 80 signals — the EventScreener can't reason about "general events" because there's no shared topic.

**Fix:** replace the regex `deriveEventTopic` with an LLM topic-classifier (Haiku, batch 20 signals/call). Map each signal to one of: litigation, M&A, sanctions, regulation, restructuring, IP, cyber, ESG, employment, finance, geopolitical, other. Cuts the "general event" bucket to <10%.

**[MEDIUM] Short aliases create false positives.** "BP" matches "BPCE" (French bank), "GS" matches "GSK", "GM" matches "GM Foods". [backend/lib/entities.js:48](backend/lib/entities.js#L48) word-boundary regex is correct but two-letter aliases inherently collide. **Fix:** require minimum alias length of 4 in [backend/lib/entities.js](backend/lib/entities.js#L1) AND add a per-entity blacklist of confused-with terms.

**[LOW] Sanctions cross-reference token matching uses ≥5-char tokens** but Apple → "ORIENTAL APPLE" still produced FPs in v6 before the deterministic pre-filter caught them. Fine as-is since the pre-filter handles it; just noting that the underlying matcher is still loose.

---

## Stage 4 — Classification (legal significance)

### What it does
[scripts/bake-helpers.js:83](scripts/bake-helpers.js#L83) `classifySignalHeuristic` flags a signal as legally significant if:
- Source-specific gate passes (EDGAR requires material markers, FCA requires enforcement language, OFAC auto-significant, etc.)
- For news sources (Tavily, GDELT): any of 30 legal keywords matches title+description.

v7 stats: **80% of Tavily signals flagged significant** (196/245).

### Issues

**[CRITICAL] 80% Tavily significance rate is unrealistic.** A senior partner reading 245 articles wouldn't find 196 worth pursuing. The keyword classifier matches "regulation" / "litigation" / "merger" in passing prose. Many flagged signals are commentary, lawyer hire announcements, secondary mentions, or industry chatter.

**Knock-on effects:**
- 223 "significant" signals → 28 event clusters, many of which are noise.
- EventScreener spends LLM tokens on weak clusters.
- Critic drops 60% of generated opps (57/92 in v7) — wasted compute.

**Fix (priority 1):** replace `classifySignalHeuristic` with `classifySignalLLM` — a Haiku-class call that reads (title + description) and returns `{ isLegallySignificant: bool, eventTopic: enum, reason: string }`. Single call per signal, batched into groups of 20 to amortize prompt overhead. Cost: ~$0.05 per bake. Expected drop in significance rate: 80% → ~30%, with much better precision.

**[HIGH] EDGAR significance rate is 1%** (1/107). The marker regex requires explicit "litigation"/"material adverse"/etc. — but most material disclosures are subtle. A 10-Q with "we expect increased regulatory scrutiny in our pharma division" would not flag, even though it's a real signal. **Fix:** same LLM classifier as above; the model can detect implicit material language.

**[MEDIUM] No multi-language support.** EU competition signals occasionally come in French/German RSS feeds; current keyword list is English-only. **Fix:** rely on Tavily's translation OR add a language detector and skip non-English content.

---

## Stage 5 — Signal fusion

### What it does
[backend/lib/signalFusion.js:30](backend/lib/signalFusion.js#L30) groups signals by `(primaryEntityId, ISO-week, eventTopic)` and annotates each with `fusionGroupSize` and `fusionSourceCount`. Cross-source corroboration boosts composer confidence.

### Issues

**[MEDIUM] Week-boundary cliff.** A real-world event spanning Saturday → Monday gets split across two ISO weeks — same entity, same topic, but two clusters. The composer sees them as separate when they're one.

**Fix:** use a 7-day rolling window keyed off median publishedAt, not ISO-week. Implementation: cluster by `(entityId, topic, dateRange)` where dateRange = `floor(timestamp / (7*86400000))` shifted by entity-median timestamp. ~20 lines in [backend/lib/signalFusion.js](backend/lib/signalFusion.js).

**[LOW] Fusion key requires `primaryEntityId`** — signals with no entity link don't fuse. Means an AI Act event affecting Microsoft + Alphabet + Apple all in the same week stays as 3 separate fusion clusters when they're really one underlying happening.

**Fix:** add a second fusion pass keyed on `(eventTopic, week)` only — exposed via a new `globalFusionGroupId`. EventScreener already does this but it'd be cleaner at the fusion layer.

---

## Stage 6 — Event clustering (for screening UI + EventScreener)

### What it does
[backend/lib/eventClusters.js:30](backend/lib/eventClusters.js#L30) `extractScreeningEvents` groups significant signals by `(eventTopic, ISO-week)`, scores by recency + source diversity + signal count, returns top N.

### Issues

**[CRITICAL] Topic distribution is heavily skewed to "general event"** (236/420 in v7 = 56%). Single largest cluster had **80 signals**. The EventScreener gets shown 8 of those 80 — and those 8 are essentially random. The 5 "exposures" the screener returns are probabilistic guesses; the critic catches all of them.

**This is the same root cause as the classifier issue (Stage 4).** Fix the classifier and this stage improves automatically.

**[MEDIUM] Cluster scoring does not penalize "general" topic.** A 80-signal "general" cluster outranks a 4-signal "patent litigation" cluster despite being far less actionable. **Fix:** add a topic-quality multiplier — `score *= topicSpecificity` where 'general event' gets 0.3, named topics get 1.0.

**[MEDIUM] Single-source bias.** Many clusters are 1src, 80sig — Tavily found 80 articles on a topic, but it's all from Tavily so cross-source corroboration is missing. **Fix:** require `sourceCount >= 2` for clusters to surface in the screening UI by default; offer "single-source events" as a separate filter.

---

## Stage 7 — EventScreener

### What it does
[backend/agents/eventScreener.js](backend/agents/eventScreener.js): for each cluster, asks LLM "which of our clients are exposed and how?". Returns 0-5 exposures.

### Issues

**[HIGH] Screener proposes exposures for entities mentioned only in passing.** v7: 28 clusters, 92 composes downstream, 35 passes — 60% drop rate at the critic stage. Most drops are "cross-entity false attribution".

**Fix #1 (already proposed):** pre-filter cluster's roster to entities mentioned in ≥2 signals.

**Fix #2:** in the screener tool schema, add `requireQuotedSignal: signalId` — the LLM must cite which signal supports each exposure. Then validate: the cited signal must mention the entity by name. Drop exposures that don't.

**[MEDIUM] Screener and composer have overlapping prompts.** Both contain the senior-partner mental model, the "95% is noise" rule, the scoring rubric. ~600 lines of prompt redundancy. **Fix:** extract a shared `BD_PARTNER_PERSONA.txt` and inject into both system prompts. Keep distinct task instructions.

**[LOW] Screener doesn't get fusion data.** It sees "this cluster has 12 signals from 2 sources" but doesn't know which signals form the multi-source corroborated subset. **Fix:** highlight fusion-cluster signals with `[CORROBORATED]` markers in the prompt.

---

## Stage 8 — Opportunity composer + critic + partner-retry

### What it does
[scripts/bake-demo.js:45](scripts/bake-demo.js#L45) `buildOpportunity()` chains:
1. Sanctions-only pre-filter (drops compliance-only opps)
2. LLM partner picker
3. Composer (Opus, full senior-partner prompt)
4. Critic (Sonnet, severity router)
5. Partner-retry on MAJOR partner-mismatch
6. Drop on BLOCKER or unrecoverable MAJOR

### Issues

**[MEDIUM] "Weak signal —" composer self-flag does not trigger drop.** v7 has 1 surviving opp with `Weak signal —` prefix (HSBC OFAC week-19). The composer correctly self-marked it; the critic passed it. **Fix:** in the critic flow at [scripts/bake-demo.js:155ish](scripts/bake-demo.js#L155), if `composed.basis.summary` starts with "Weak signal —", auto-drop. Don't even run the critic.

**[MEDIUM] Score distribution tightly clustered (50-69 = 25 of 35).** Composer follows the rubric ("60-79: reasonable but diluted") religiously, so 70%+ of opps land in the same band. Hard to distinguish strong from weak on the cards. **Fix:** widen the rubric ranges and ask composer to use the FULL 0-100 range. Add explicit anchors: "100 = textbook. 50 = median. 0 = noise."

**[MEDIUM] Partner-retry never succeeds in v7** (`partnerRetrySuccesses: 0, partnerRetryDrops: 3`). Means the retry path is purely a drop mechanism. Worth checking why: probably the matcher LLM, when re-asked with the wrong partner excluded, just picks another partner who's also a poor fit (because the firm genuinely lacks a specialist). **Fix:** when retry fails, log which (service, sector) combos hit "no good fit" — that's a firm capability gap to surface. Could even render in a "Capability gaps detected" sidebar widget.

**[LOW] Partner picker doesn't use fusion data either.** Same as screener.

---

## Stage 9 — Briefing generation

### What it does
[backend/agents/briefingGenerator.js](backend/agents/briefingGenerator.js) generates a full pitch brief for top 14 opps. Used on the Detail page.

### Issues

**[MEDIUM] Only top 14 opps get briefings** (sorted by score). With 35 opps, 21 don't get briefings. Detail page falls back to heuristic briefing for those — readable but generic. **Fix:** raise to top 25, or generate on-demand when user opens detail page (lazy + cached).

**[LOW] Briefings can repeat the composer's reasoning verbatim.** The two prompts overlap. **Fix:** brief prompt should explicitly say "do NOT repeat the composer's summary; expand on the operational specifics".

---

## Cross-cutting issues

### A. No live re-ingestion
The bake is one-shot; signals are frozen until the next `npm run bake`. If a major event breaks 1 hour after bake, the platform doesn't know. **Fix:** add `POST /workspaces/:id/screening/refresh-sources` (already in the plan, not yet implemented) that re-runs Tavily + RSS for the last 24h and merges into the existing pool. Cheap (~$0.05) and makes the demo feel live.

### B. Bake output is not idempotent across re-runs
Re-baking with the same inputs produces different opps because LLM nondeterminism. Acceptable for demos but means we can't cache between reloads. **Fix:** add `temperature: 0` to all composer/screener calls in [backend/agents/client.js:106](backend/agents/client.js#L106).

### C. No cost tracking
No counter on tokens/calls. We don't know if a single bake costs $0.50 or $5. **Fix:** thread an `apiUsage` accumulator through `callTool` and `callText` in [backend/agents/client.js](backend/agents/client.js); print in bake summary.

### D. Audit trail is thin on agent decisions
[backend/lib/audit.js](backend/lib/audit.js) records engine_run events but not the actual LLM input/output. If an opp looks wrong, you can't replay how it was generated. **Fix:** record full prompts + tool outputs (truncated to 2KB) on every LLM call.

---

## Recommended fix priority

| Priority | Fix | Effort | Impact |
|---|---|---|---|
| **P0** | Replace heuristic classifier with LLM classifier (Stage 4) | 4h | Fixes 80% Tavily over-flagging, the "general event" pile, and 60% critic-drop waste |
| **P0** | Pre-filter screener roster to ≥2-signal entities (Stage 3, 7) | 1h | Cuts cross-entity false attributions in half |
| **P1** | Fix the silent RSS feeds (Stage 1) | 2h | Doubles regulatory signal coverage |
| **P1** | Auto-drop "Weak signal —" composer self-flags (Stage 8) | 30m | One-line fix; user already sees this issue |
| **P1** | Get CourtListener + Companies House keys | external | Whole new signal class |
| **P2** | Content-based dedupe (Stage 2) | 1h | Cleans display |
| **P2** | Topic-specificity scoring (Stage 6) | 30m | Better screening UI ranking |
| **P2** | Cost tracking + temperature 0 (Cross-cutting) | 1h | Operational hygiene |
| **P3** | Live refresh button (Cross-cutting) | 3h | Demo polish |
| **P3** | Capability-gap surfacing from partner-retry drops (Stage 8) | 2h | Turns a current dead-end into a feature |

**Single biggest lever: fix the classifier.** Stage 4 is upstream of everything else; 80% over-flagging is poisoning the rest of the pipeline. Estimated 30–40% improvement in surviving opp quality with one focused change.
