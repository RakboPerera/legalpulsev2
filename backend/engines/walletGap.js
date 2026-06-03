// Phase 3 / Change 1 — Wallet-share gap engine.
//
// Emits one opportunity per existing client where the firm has
// material untapped wallet (gap > £500k AND share < 60%). These are
// slow-moving relationship plays — not event-driven — so the urgency
// tier is 'steady_state' and the score is anchored on how big the
// gap is, not how urgent.
//
// Mirrors the crossSell.js engine pattern but does NOT call an LLM
// agent — the heuristic-first methodology is sufficient and the
// output reasoning is built from the deterministic computeWalletGap
// output. A later enhancement could route the basis.reasoning through
// the opportunityComposer for richer language.

import { opportunityId } from '../lib/ids.js';
import { addAuditEntry } from '../lib/audit.js';
import { deriveSeverity } from '../lib/severity.js';
import { computeWalletGap } from '../lib/walletGap.js';

// Practice area → flagship service. Used to set suggestedService on
// the emitted opportunity (the existing UI filters and label dicts
// expect a service ID, not a practice area). The first service listed
// in each practice in data/seed/service-taxonomy.json is the natural
// flagship.
const PRACTICE_FLAGSHIP_SERVICE = {
  corporate_ma:             'ma_advisory',
  banking_finance:          'leveraged_finance',
  litigation_disputes:      'commercial_litigation',
  regulatory_compliance:    'merger_control',
  energy_natural_resources: 'oil_gas_advisory',
  ip_technology:            'technology_transactions',
  real_estate:              'commercial_real_estate',
  restructuring_insolvency: 'corporate_restructuring',
  tax:                      'corporate_tax',
  employment:               'senior_executive_employment',
  sanctions_trade:          'export_controls'
};

// Pretty-print a practice area in the reasoning prose (snake_case →
// title case + acronym repair).
const PRACTICE_LABEL = {
  corporate_ma:             'Corporate M&A',
  banking_finance:          'Banking & Finance',
  litigation_disputes:      'Litigation & Disputes',
  regulatory_compliance:    'Regulatory & Compliance',
  energy_natural_resources: 'Energy & Natural Resources',
  ip_technology:            'IP & Technology',
  real_estate:              'Real Estate',
  restructuring_insolvency: 'Restructuring & Insolvency',
  tax:                      'Tax',
  employment:               'Employment',
  sanctions_trade:          'Sanctions & Trade'
};
const prettyPractice = p => PRACTICE_LABEL[p] || (p || '').replace(/_/g, ' ');

// Format a GBP amount with the same compact convention used elsewhere
// in the app (£12M / £640k). Used inside the basis.summary string.
function fmtGbp(n) {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `£${(n / 1e9).toFixed(1)}bn`;
  if (a >= 1e6) return `£${(n / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `£${(n / 1e3).toFixed(0)}k`;
  return `£${Math.round(n).toLocaleString()}`;
}

// Engine entry point. Mirrors the runner signatures in crossSell.js,
// eventIntelligence.js and prospectDiscovery.js. The pipeline runner
// in backend/routes/pipeline.js passes { workspace, apiKey, provider }
// — apiKey/provider are unused here (heuristic-only) but accepted for
// consistency.
export async function runWalletGapEngine({ workspace, limit = 20 } = {}) {
  const opportunities = [];
  const clients = workspace.clients || [];
  const matters = workspace.matters || [];

  for (const client of clients) {
    if (opportunities.length >= limit) break;
    const gap = computeWalletGap({ client, allMatters: matters });
    if (!gap) continue;

    // Filter: only emit when there's a real, material upside left.
    // - gap < £500k → not worth a partner conversation
    // - share ≥ 60% → already deep into the wallet, no story to tell
    if (gap.gapGbp < 500_000) continue;
    if (gap.walletSharePct != null && gap.walletSharePct >= 0.60) continue;

    // Score scales with how UN-captured the client is. ≤30% share is
    // the big-gap territory; >30% scores lower. Floors at 50 so the
    // critic gate doesn't suppress.
    const sharePct = gap.walletSharePct ?? 0;
    const score = sharePct < 0.30 ? 90 : sharePct < 0.45 ? 78 : 65;

    // Suggested service: the flagship service of the top untapped
    // practice area. If the firm covers no practice area the client
    // doesn't already use, skip (no clear pitch).
    const topPractice = gap.gapByPracticeArea[0];
    if (!topPractice) continue;
    const suggestedService = PRACTICE_FLAGSHIP_SERVICE[topPractice] || topPractice;

    // Headline summary matches the deck's phrasing closely (slide 6).
    const sharePctText = sharePct ? (sharePct * 100).toFixed(1) + '%' : '<1%';
    const topPracticesText = gap.gapByPracticeArea.slice(0, 3).map(prettyPractice).join(', ');
    const summary = `You capture ~${sharePctText} of ${client.legalName}'s estimated ${fmtGbp(gap.estimatedTotalGbp)} legal spend — ${fmtGbp(gap.gapGbp)} addressable, concentrated in ${topPracticesText}.`;

    // Longer reasoning includes the methodology so partners can interrogate.
    const reasoning = [
      `Heuristic: revenue × sector benchmark × size adjustment.`,
      `Revenue ${fmtGbp(gap.methodology.revenueGbp)} (${gap.methodology.fiscalYear || 'FY24'}, ${gap.methodology.source || 'public filing'}).`,
      `Sector ratio: ${(gap.methodology.sectorRatio * 10_000).toFixed(0)} bp (${prettyPractice(gap.sector)} sector benchmark).`,
      `Size adjustment: ×${gap.methodology.sizeAdjustment.toFixed(2)} (${client.size}-cap multinational premium).`,
      `Trailing-12m internal billing: ${fmtGbp(gap.internalBilledGbp)}.`,
      `Estimated total: ${fmtGbp(gap.estimatedTotalGbp)} → gap ${fmtGbp(gap.gapGbp)} (${gap.gapByPracticeArea.length} firm practices not yet billed to this client).`
    ].join(' ');

    // Estimated revenue: conservative 25% capture-rate target of the
    // identified gap. Used by KPI tiles and downstream pitch-prep.
    const estimatedRevenueGbp = Math.round(gap.gapGbp * 0.25);

    opportunities.push({
      id: opportunityId('wallet_gap', client.id, suggestedService, []),
      type: 'wallet_gap',
      engineSource: 'wallet_gap',
      entity: client.id,
      entityType: 'client',
      suggestedService,
      urgencyTier: 'steady_state',
      confidence: 0.85,  // heuristic computation, high confidence in the math; the relationship judgement is the partner's
      severity: deriveSeverity({ urgencyTier: 'steady_state', confidence: 0.85, engine: 'wallet_gap' }),
      estimatedRevenue: estimatedRevenueGbp,
      competitiveContext: 'moderate',
      score,
      triggers: gap.gapByPracticeArea.slice(0, 3),
      generatedAt: new Date().toISOString(),
      status: 'new',
      statusHistory: [{ status: 'new', changedBy: 'wallet_gap_engine', changedAt: new Date().toISOString() }],
      notes: '',
      basis: {
        summary,
        signalIds: [],
        matterReferences: matters.filter(m => m.client === client.id).slice(0, 3).map(m => m.id),
        reasoning,
        // Attach the raw walletGap payload so the UI can render the
        // estimated-spend / share / gap block on ClientDetail and on
        // the opp card without re-computing.
        walletGap: {
          internalBilledGbp: gap.internalBilledGbp,
          estimatedTotalGbp: gap.estimatedTotalGbp,
          walletSharePct:    gap.walletSharePct,
          gapGbp:            gap.gapGbp,
          gapByPracticeArea: gap.gapByPracticeArea,
          methodology:       gap.methodology
        }
      }
    });
    addAuditEntry(workspace, {
      type: 'engine_run',
      actor: 'wallet_gap_engine',
      inputs: { clientId: client.id, sector: client.sector },
      outputs: {
        gapGbp: gap.gapGbp,
        walletSharePct: gap.walletSharePct,
        topPractice
      }
    });
  }
  return opportunities;
}
