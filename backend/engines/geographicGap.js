// Phase 3 / Change 5 — Geographic-gap engine.
//
// Deck slide 9: "You're strong with a global client in one region but
// absent in another — surfaced as a target."
//
// For each client we know operates in multiple countries, compute the
// set of countries where:
//   (a) the client operates (from client.countriesOfOperation),
//   (b) the firm has demonstrable presence (matter history with other
//       clients with that country as their HQ),
//   (c) the firm has NO matter history with THIS client (so there's
//       real upside to pursue).
//
// Heuristic-only (no LLM dependency). The matter ↔ country link is
// approximate — we use each client's hqJurisdiction as the proxy for
// where their matters happen. That's a simplification (some matters
// are cross-border) but it's the cleanest signal in the seed schema.
//
// Emits one opportunity per (client, missing-region) pair, capped at
// 2 per client to avoid drowning the board with the same client's
// flag. Score weighted by how many missing markets exist + how
// strongly the firm operates in that market for other clients.

import { opportunityId } from '../lib/ids.js';
import { addAuditEntry } from '../lib/audit.js';
import { deriveSeverity } from '../lib/severity.js';

const PRACTICE_FLAGSHIP_SERVICE = {
  corporate_ma:             'cross_border_ma',
  banking_finance:          'project_finance',
  litigation_disputes:      'international_arbitration',
  regulatory_compliance:    'merger_control',
  energy_natural_resources: 'oil_gas_advisory',
  ip_technology:            'technology_transactions',
  real_estate:              'commercial_real_estate',
  restructuring_insolvency: 'corporate_restructuring',
  tax:                      'international_tax',
  employment:               'workforce_restructuring',
  sanctions_trade:          'export_controls'
};

// Aggregate the firm's jurisdiction footprint from the matter ledger.
// Each matter is attributed to its client's hqJurisdiction; we count
// matters per country across the full ledger.
function deriveFirmJurisdictionFootprint({ clients, matters }) {
  const clientById = new Map(clients.map(c => [c.id, c]));
  const footprint = new Map(); // country → matter count
  for (const m of matters || []) {
    const cl = clientById.get(m.client);
    if (!cl?.hqJurisdiction) continue;
    footprint.set(cl.hqJurisdiction, (footprint.get(cl.hqJurisdiction) || 0) + 1);
  }
  return footprint;
}

// Find the practice areas where the firm has demonstrable presence in
// the missing country (matters for other clients HQ'd there). Used to
// pick a realistic suggested service for the cross-border pitch.
function topPracticesInJurisdiction({ jurisdiction, clients, matters }) {
  const clientById = new Map(clients.map(c => [c.id, c]));
  const counts = new Map();
  for (const m of matters || []) {
    const cl = clientById.get(m.client);
    if (cl?.hqJurisdiction !== jurisdiction) continue;
    if (m.practiceArea) counts.set(m.practiceArea, (counts.get(m.practiceArea) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
}

export async function runGeographicGapEngine({ workspace, limit = 20 } = {}) {
  const opportunities = [];
  const clients = workspace.clients || [];
  const matters = workspace.matters || [];

  const firmFootprint = deriveFirmJurisdictionFootprint({ clients, matters });

  for (const client of clients) {
    if (opportunities.length >= limit) break;
    const operatesIn = Array.isArray(client.countriesOfOperation) ? client.countriesOfOperation : [];
    if (operatesIn.length < 2) continue;  // need multi-country exposure for the gap to be meaningful

    // Jurisdictions where the firm has matter history for THIS client.
    // Using hqJurisdiction as proxy: if any of this client's matters
    // exist, they're treated as serving the client's HQ country.
    const clientMatters = matters.filter(m => m.client === client.id);
    const servedJurisdictions = new Set();
    if (clientMatters.length > 0 && client.hqJurisdiction) {
      servedJurisdictions.add(client.hqJurisdiction);
    }

    // Missing markets: countries the client operates in, where the
    // firm has some demonstrable presence (≥3 matters from other
    // clients) but no engagement with this client.
    const candidates = operatesIn
      .filter(country => country !== client.hqJurisdiction)
      .filter(country => !servedJurisdictions.has(country))
      .filter(country => (firmFootprint.get(country) || 0) >= 3)
      .sort((a, b) => (firmFootprint.get(b) || 0) - (firmFootprint.get(a) || 0));

    if (!candidates.length) continue;

    // Emit up to 2 opportunities per client (top two missing markets)
    // to avoid one mega-client dominating the board.
    for (const country of candidates.slice(0, 2)) {
      if (opportunities.length >= limit) break;
      const firmReach = firmFootprint.get(country) || 0;
      const topPractices = topPracticesInJurisdiction({ jurisdiction: country, clients, matters });
      const topPractice = topPractices[0];
      if (!topPractice) continue;

      const suggestedService = PRACTICE_FLAGSHIP_SERVICE[topPractice] || topPractice;

      // Score: prefer pitches into markets where the firm has strong
      // presence (high reach + multiple practice options).
      const baseScore = 60;
      const reachBonus = Math.min(20, Math.floor(firmReach / 2));
      const practiceBonus = Math.min(10, topPractices.length * 2);
      const score = baseScore + reachBonus + practiceBonus;

      const summary = `${client.legalName} operates in ${country} but the firm has no matter history with them there. The firm has handled ${firmReach} ${topPractice.replace(/_/g, ' ')}-adjacent matters in ${country} for other clients — a credible cross-border move.`;
      const reasoning = [
        `Client operates in: ${operatesIn.join(', ')}.`,
        `HQ jurisdiction: ${client.hqJurisdiction || '—'}. The firm's matter history with this client is concentrated there.`,
        `Firm presence in ${country}: ${firmReach} matters across ${topPractices.slice(0, 3).map(p => p.replace(/_/g, ' ')).join(', ')} for other clients.`,
        `Suggested play: introduce ${suggestedService.replace(/_/g, ' ')} for ${client.legalName} in ${country}.`
      ].join(' ');

      opportunities.push({
        // Country is part of the entity-id slot rather than the signalIds
        // slot — geographic_gap has no source signals (heuristic-only),
        // and we want one stable id per (client, country) pair. Using
        // signalIds for the country mis-uses the parameter semantically;
        // composing it into the entity id is cleaner and produces an
        // identical-shape deterministic hash.
        id: opportunityId('geographic_gap', `${client.id}:${country}`, suggestedService, []),
        type: 'geographic_gap',
        engineSource: 'geographic_gap',
        entity: client.id,
        entityType: 'client',
        suggestedService,
        urgencyTier: 'steady_state',
        confidence: 0.75,
        severity: deriveSeverity({ urgencyTier: 'steady_state', confidence: 0.75, engine: 'geographic_gap' }),
        estimatedRevenue: null,
        competitiveContext: 'open',
        score,
        triggers: [country, topPractice],
        generatedAt: new Date().toISOString(),
        status: 'new',
        statusHistory: [{ status: 'new', changedBy: 'geographic_gap_engine', changedAt: new Date().toISOString() }],
        notes: '',
        basis: {
          summary,
          signalIds: [],
          matterReferences: clientMatters.slice(0, 3).map(m => m.id),
          reasoning,
          geographicGap: {
            missingCountry: country,
            firmReachMatterCount: firmReach,
            topPracticesInCountry: topPractices.slice(0, 5),
            clientCountriesOfOperation: operatesIn,
            clientHqJurisdiction: client.hqJurisdiction || null
          }
        }
      });
      addAuditEntry(workspace, {
        type: 'engine_run',
        actor: 'geographic_gap_engine',
        inputs: { clientId: client.id, missingCountry: country },
        outputs: { firmReach, topPractice }
      });
    }
  }
  return opportunities;
}
