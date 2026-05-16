import { profileProspect } from '../agents/prospectProfiler.js';
import { opportunityId } from '../lib/ids.js';
import { addAuditEntry } from '../lib/audit.js';
import { deriveSeverity } from '../lib/severity.js';

export async function runProspectDiscoveryEngine({ workspace, apiKey, provider, limit = 15 }) {
  const opportunities = [];
  for (const prospect of (workspace.prospects || [])) {
    const signals = (workspace.signals || []).filter(s =>
      (s.entities || []).some(e => e.entityId === prospect.id)).slice(-10);
    if (!signals.length) continue;
    let profile;
    try {
      profile = await profileProspect({
        prospect, signals, firmPracticeAreas: workspace.firmProfile?.practiceAreas || [], apiKey, provider
      });
    } catch (err) {
      console.warn(`[prospect] profile failed for ${prospect.id}: ${err.message}`);
      continue;
    }

    const id = opportunityId('prospect_discovery', prospect.id, profile.pickedService, signals.map(s => s.id));
    const urgencyTier = profile.urgencyTier || 'steady_state';
    const confidence = profile.confidence ?? 0.55;
    opportunities.push({
      id,
      type: 'prospect',
      engineSource: 'prospect_discovery',
      entity: prospect.id,
      entityType: 'prospect',
      suggestedService: profile.pickedService,
      urgencyTier,
      confidence,
      severity: deriveSeverity({
        urgencyTier, confidence, engine: 'prospect_discovery',
        signalSources: signals.map(s => s.source)
      }),
      estimatedRevenue: null,
      competitiveContext: 'moderate',
      score: Math.round(40 + confidence * 50),
      generatedAt: new Date().toISOString(),
      status: 'new',
      statusHistory: [{ status: 'new', changedBy: 'prospect_engine', changedAt: new Date().toISOString() }],
      notes: 'PROSPECT — review for solicitation compliance before outreach.',
      basis: {
        summary: profile.keyExposureSummary || profile.rationale,
        signalIds: signals.map(s => s.id),
        matterReferences: [],
        reasoning: profile.rationale
      }
    });
    addAuditEntry(workspace, {
      type: 'engine_run',
      actor: 'prospect_discovery_engine',
      inputs: { prospectId: prospect.id, signalCount: signals.length },
      outputs: { picked: profile.pickedService, confidence: profile.confidence }
    });
    if (opportunities.length >= limit) break;
  }
  return opportunities;
}
