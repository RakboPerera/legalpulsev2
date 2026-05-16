// Reconstruct rejected opportunities from the heuristic bake's output that
// did NOT survive partner-quality review. Each rejection is hand-authored
// with a specific reason citing the actual signal content, so the
// Reasoning Trail page can show partners what was filtered and why —
// not as generic categories, but as concrete sentences.
//
// One-shot: reads data/demo-snapshot.backup-pre-no-llm-bake.json (the 37
// heuristic candidates), diffs against the current snapshot's surviving
// (entity, service) tuples, and emits data/rejected-opportunities.json.
//
// Future bakes will append to this file via instrumented drop paths in
// bake-demo.js (see plan, Phase 2, "Step B"). Until then, this file is
// authoritative for historical drops.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');

const backup = JSON.parse(fs.readFileSync(path.join(dataDir, 'demo-snapshot.backup-pre-no-llm-bake.json'), 'utf8'));
const current = JSON.parse(fs.readFileSync(path.join(dataDir, 'demo-snapshot.json'), 'utf8'));

function rejId(entity, service, sigIds, code) {
  const h = crypto.createHash('sha256')
    .update([entity, service, [...sigIds].sort().join(','), code].join('|'))
    .digest('hex').slice(0, 16);
  return `rej-${h}`;
}

// Reason taxonomy — keep in lockstep with the plan.
const REASON_LABELS = {
  cross_entity_attribution: 'Cited signals are about a different entity or context',
  service_mismatch:         'Service doesn\'t fit the signal content',
  service_overgeneration:   'Heuristic spawned multiple irrelevant services from one cluster',
  zero_signals:             'Cross-sell with no supporting event signals',
  weak_trigger:             'Signal exists but creates no actionable legal need',
  dockets_only:             'Court captions only, no substantive claim text',
  substring_collision:      'Sanctions / alias false-positive on unrelated entity',
  duplicate_engine_output:  'Same (entity, service) surfaced by another engine — kept higher-scored version',
  system_miss:              'Heuristic call was defensible; partner-judgment dropped it but worth re-review'
};

// === Hand-curated reasons per dropped (entity, service) tuple. ===
// Keys are "entityId|service". Author each as a 1-2 sentence partner-readable
// explanation citing the actual signal content. The script will skip any
// dropped tuple not present here — keeps the file tight and high-signal.
const REASONS = {
  // ---- BP: heuristic overgenerated services from two unrelated clusters
  'c-bp|esg_compliance': {
    code: 'zero_signals',
    text: "Cross-sell match on sector positioning only. Cited signals are about BP's Venezuela gas exploration deal — unrelated to ESG compliance work. No prior ESG matter pattern with us to justify a structural cross-sell either."
  },
  'c-bp|ofac_advisory': {
    code: 'service_mismatch',
    text: "Signals are a BP-Venezuela offshore gas exploration deal plus an OPay valuation press release that names JPMorgan and Citi (not BP). Venezuela exposure could merit OFAC review eventually, but the cited articles don't describe a sanctions trigger — they're commercial M&A coverage."
  },
  'c-bp|joint_ventures': {
    code: 'service_overgeneration',
    text: "Heuristic spawned this from the same Venezuela-gas-deal cluster that produced the OFAC reject. The deal is technically a JV, but the cluster is too thin to support a pitch (single deal announcement, no execution-phase needs surfaced)."
  },
  'c-bp|ma_advisory': {
    code: 'system_miss',
    text: "Cited signals confirm BP is reviewing UK North Sea divestiture worth ~£2bn (World Oil + Global Banking & Finance Review). This was actually a real M&A trigger — partner-judgment pass dropped it in favour of letting the cluster be handled under force-majeure for the Hormuz angle. Worth re-review by the corporate partner."
  },
  'c-bp|decommissioning': {
    code: 'service_overgeneration',
    text: "Same UK North Sea exit cluster as the ma_advisory above. Decommissioning would only fire if BP actually retains the assets and wraps them down — the news is a SALE, which is M&A work, not decommissioning."
  },
  'c-bp|windfall_tax_advisory': {
    code: 'service_overgeneration',
    text: "Same North Sea exit cluster. Energy Profits Levy applies to producers, not sellers — if BP exits, the levy work moves with the buyer, not the seller. Wrong service routing."
  },
  'c-bp|corporate_restructuring': {
    code: 'service_overgeneration',
    text: "Same North Sea exit cluster. 'Restructuring' here means asset-portfolio review, not Chapter-11-style insolvency restructuring (which is the firm's restructuring practice). Service taxonomy mismatch."
  },

  // ---- Exxon: M&A from oil-price commentary
  'c-exxon|ma_advisory': {
    code: 'service_mismatch',
    text: "Signal is a Law360 article on whether Exxon can be subpoenaed in a French climate suit — that's litigation work, not M&A. Heuristic regex matched on the word 'subpoena' → 'litigation' but routed to 'ma_advisory' for unclear reasons; misfire."
  },

  // ---- Chevron: zero-signal cross-sells
  'c-chevron|cross_border_ma': {
    code: 'zero_signals',
    text: "Cross-sell match on sector cluster (oil_gas / mega) alone — no supporting event signals at all. Peer adoption pattern was thin in the same cluster; not strong enough to pitch without a triggering event."
  },
  'c-chevron|decommissioning': {
    code: 'zero_signals',
    text: "Same zero-signal pattern. Chevron has not announced any decommissioning programmes in the data; the heuristic matched on sector + service-frequency in peers, but the evidence is too thin."
  },

  // ---- Goldman Sachs: macro commentary
  'c-gs|leveraged_finance': {
    code: 'weak_trigger',
    text: "Cited signal is a Bloomberg article on OpenAI's $10bn joint venture with PE firms — GS isn't named as the financier in the article. The heuristic latched on 'PE firms' + 'banking' and assumed Goldman exposure; no concrete mandate."
  },
  'c-gs|acquisition_finance': {
    code: 'weak_trigger',
    text: "Same OpenAI-PE-JV signal. Speculative routing — Goldman might or might not be the lender of choice for OpenAI's deployment financing; the article doesn't say."
  },

  // ---- Bank of America: zero signals
  'c-bofa|leveraged_finance': {
    code: 'zero_signals',
    text: "Cross-sell from banking-sector cluster with no event signals. BoA's recent matter history with the firm doesn't include leveraged-finance work to justify a structural pitch either."
  },
  'c-bofa|acquisition_finance': {
    code: 'zero_signals',
    text: "Same — no signals, no triggering event. Cross-sell engine matched on peer-firm adoption of acquisition_finance in the banking cluster but couldn't connect it to a BoA-specific opportunity."
  },

  // ---- Morgan Stanley: foreign investigation
  'c-ms|financial_services_regulation': {
    code: 'weak_trigger',
    text: "WSJ reports Morgan Stanley's Budapest investment-banking programme is under US probe. Real signal, but it's a single-source story without specifics — outreach pitch would need confirmation via PACER / DOJ press release before approaching the GC."
  },
  'c-ms|regulatory_defense': {
    code: 'duplicate_engine_output',
    text: "Same WSJ Budapest-probe signal as the financial_services_regulation reject above. Heuristic spawned two services off the same investigation; if one is going to be pitched it should be financial_services_regulation, not both."
  },

  // ---- Barclays: shareholder firm noise
  'c-barclays|acquisition_finance': {
    code: 'service_mismatch',
    text: "Cited signal is a Rosen Law Firm press release encouraging Barclays securities-class-action investigators — that's a SECURITIES_LITIGATION trigger (defence side), not acquisition_finance. Service routing misfire."
  },

  // ---- Apple: substring collisions + unrelated suits
  'c-apple|uk_competition': {
    code: 'substring_collision',
    text: "Heuristic linked Apple Inc. via an OFAC SDN substring match against 'ORIENTAL APPLE COMPANY PTE LTD' (unrelated foreign entity). The other cited signals — Rave's app-store suit, a $250m AI-claims settlement — are real Apple matters but don't create UK competition work specifically."
  },
  'c-apple|eu_competition': {
    code: 'substring_collision',
    text: "Same OFAC-substring + Rave-app-store signals as the UK reject. The app-store dispute could conceivably trigger EU competition follow-on, but the cited material doesn't establish that link."
  },

  // ---- Amazon: completely cross-attribution
  'c-amazon|ai_regulation_advisory': {
    code: 'cross_entity_attribution',
    text: "Cited signals are a Volkswagen-Rivian filing in Uzbek and an FCA US (Stellantis) Ram pickup recall. Neither involves Amazon, let alone AI regulation. Pure entity-link false-positive — likely matched on 'AI' keyword in tangential coverage."
  },

  // ---- Anthropic: service mismatch (kept under commercial_litigation)
  'pr-anthropic|ai_regulation_advisory': {
    code: 'service_mismatch',
    text: "Heuristic picked ai_regulation_advisory off the White House AI memo / Pentagon-feud signal. The actual triggers for Anthropic in this snapshot are the three publisher copyright suits (Cruz, Chicken Soup, Cognella) — kept as commercial_litigation, which is the right service for AI training-data litigation defence."
  },

  // ---- Pfizer: service mismatch — class actions is the real wave
  'pr-pfizer|patent_litigation': {
    code: 'service_mismatch',
    text: "Cited signal is a GSK-Acuitas COVID-shot patent case — about GSK, not Pfizer. Heuristic entity-linked Pfizer via the 'Covid' keyword. Pfizer's real Class-Action wave (10+ filings on a single day) is the kept opportunity."
  },

  // ---- HSBC: service overgeneration on the MFS fraud cluster
  'c-hsbc|regulatory_defense': {
    code: 'service_overgeneration',
    text: "Same HSBC $400m MFS-fraud cluster that produced the kept financial_services_regulation opp. Regulatory_defense is a plausible adjacent service, but FCA s.166 review (financial_services_regulation) is the more specific routing for this trigger."
  },
  'c-hsbc|commercial_litigation': {
    code: 'service_overgeneration',
    text: "Same MFS-fraud cluster. Recovery litigation against the fraudster IS a commercial_litigation angle, but the lead service for HSBC's exposure is the FCA-level regulatory review — kept as financial_services_regulation."
  },

  // ---- VW: recall pattern that didn't survive
  'c-vw|product_liability': {
    code: 'duplicate_engine_output',
    text: "Two Consumer Reports / Motor1 articles on Volkswagen Taos recalls (fuel-tank + fire risk). Real triggers, but the engine-dedup pass kept the cross_border_ma version of the VW opp (Rivian top-shareholder filing) which scored higher. Product-liability remains a fair re-review candidate."
  },
  'c-vw|class_actions': {
    code: 'duplicate_engine_output',
    text: "Same VW recall signals as the product_liability reject. Two services off one event cluster; the manual-rewrite kept cross_border_ma instead. If the recalls drive litigation, this returns as a real class_actions opportunity."
  },

  // ---- Market Financial Solutions: auto-discovered prospect from HSBC fraud
  'pr-screen-market-financial-solutions-ltd|corporate_restructuring': {
    code: 'system_miss',
    text: "Auto-prospect-discovery flagged MFS as a new prospect off the HSBC-$400m-fraud cluster (MFS being the collapsed counterparty). Restructuring would be the natural service if MFS is in administration — but the firm's existing client (HSBC) is the recovery-side party, creating a likely conflict. Dropped on conflict grounds; data captured for completeness."
  }
};

// === Build the rejection list ===
const sigById = new Map(backup.signals.map(s => [s.id, s]));
const currentTuples = new Set(current.opportunities.map(o => `${o.entity}|${o.suggestedService}`));
const now = new Date().toISOString();
const rejections = [];
let skipped = 0;
let coveredKeys = new Set();

for (const o of backup.opportunities) {
  const key = `${o.entity}|${o.suggestedService}`;
  if (currentTuples.has(key)) continue; // survived (possibly with new ID)
  const reason = REASONS[key];
  if (!reason) {
    console.warn(`[reconstruct] no curated reason for ${key} — skipping`);
    skipped++;
    continue;
  }
  if (coveredKeys.has(key)) continue; // dedup same tuple
  coveredKeys.add(key);

  const entity = [...backup.clients, ...backup.prospects].find(e => e.id === o.entity);
  const signalIds = o.basis?.signalIds || [];
  // Inline the full signal stubs (title, source, url, excerpt, publishedAt)
  // so the rejection record is self-contained. Signal IDs in the backup
  // bake won't necessarily match the current snapshot's IDs (different
  // run, different URL canonicalisation, different theme scope), so
  // pointing at IDs is unreliable — embed the data the partner needs.
  const signals = signalIds
    .map(id => sigById.get(id))
    .filter(Boolean)
    .map(s => ({
      id: s.id,
      source: s.source,
      title: s.title,
      excerpt: (s.description || '').slice(0, 280),
      url: s.sourceUrl,
      publishedAt: s.publishedAt
    }));
  rejections.push({
    id: rejId(o.entity, o.suggestedService, signalIds, reason.code),
    entity: o.entity,
    entityName: entity?.legalName || o.entity,
    entityType: o.entityType || (o.entity?.startsWith('pr-') ? 'prospect' : 'client'),
    sector: entity?.sector,
    hqJurisdiction: entity?.hqJurisdiction,
    service: o.suggestedService,
    engineSource: o.engineSource,
    originalScore: o.score ?? null,
    signalIds,
    signals,
    reasonCode: reason.code,
    reasonLabel: REASON_LABELS[reason.code] || reason.code,
    reasonText: reason.text,
    droppedBy: 'manual-rewrite',
    droppedAt: now
  });
}

const out = {
  generatedAt: now,
  generatedBy: 'scripts/reconstruct-rejected-opportunities.js',
  source: 'data/demo-snapshot.backup-pre-no-llm-bake.json (heuristic bake) vs current (partner-judged)',
  reasonTaxonomy: REASON_LABELS,
  rejections
};

fs.writeFileSync(path.join(dataDir, 'rejected-opportunities.json'), JSON.stringify(out, null, 2));
console.log(`[reconstruct] wrote data/rejected-opportunities.json`);
console.log(`[reconstruct] rejections: ${rejections.length} (skipped uncurated: ${skipped})`);
console.log(`[reconstruct] by reason:`);
const byCode = {};
for (const r of rejections) byCode[r.reasonCode] = (byCode[r.reasonCode] || 0) + 1;
for (const [code, n] of Object.entries(byCode).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${code.padEnd(30)} ${n}`);
}
