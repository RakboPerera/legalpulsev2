import { classifySignal } from '../agents/signalClassifier.js';
import { mapIndustryImpact } from '../agents/industryImpactMapper.js';
import { mapLegalNeeds } from '../agents/legalNeedsMapper.js';
import { opportunityId } from '../lib/ids.js';
import { addAuditEntry } from '../lib/audit.js';
import { deriveSeverity } from '../lib/severity.js';

function entitiesAffected(signal, workspace) {
  return (signal.entities || [])
    .map(e => e.entityId)
    .filter(Boolean)
    .map(id =>
      (workspace.clients || []).find(c => c.id === id) ||
      (workspace.prospects || []).find(p => p.id === id))
    .filter(Boolean);
}

export async function runEventIntelligenceEngine({ workspace, apiKey, provider, limit = 25, classifyLimit = 50 }) {
  const significantSignals = [];
  const signalsToClassify = (workspace.signals || []).filter(s => s.isLegallySignificant === undefined).slice(0, classifyLimit);

  for (const sig of signalsToClassify) {
    try {
      const cls = await classifySignal(sig, { apiKey, provider });
      sig.classifiedAt = new Date().toISOString();
      sig.isLegallySignificant = cls.isLegallySignificant;
      sig.legalSignificanceReason = cls.reason;
      sig.affectedIndustries = cls.affectedIndustries;
      addAuditEntry(workspace, {
        type: 'classification', actor: 'signal_classifier_agent',
        inputs: { signalId: sig.id },
        outputs: { isLegallySignificant: cls.isLegallySignificant, eventTopic: cls.eventTopic }
      });
    } catch (err) {
      console.warn(`[event] classify failed for ${sig.id}: ${err.message}`);
    }
  }

  for (const sig of (workspace.signals || [])) {
    if (sig.isLegallySignificant) significantSignals.push(sig);
  }

  const opportunities = [];
  for (const sig of significantSignals) {
    const affected = entitiesAffected(sig, workspace);
    if (!affected.length) continue;

    let industryMap, needsMap;
    try {
      industryMap = await mapIndustryImpact(sig, { apiKey, provider });
      needsMap = await mapLegalNeeds(sig, industryMap.affectedIndustries || [], { apiKey, provider });
    } catch (err) {
      console.warn(`[event] mapping failed for ${sig.id}: ${err.message}`);
      continue;
    }

    sig.legalNeedsArising = needsMap.legalNeeds;
    addAuditEntry(workspace, {
      type: 'engine_run', actor: 'event_intelligence_engine',
      inputs: { signalId: sig.id },
      outputs: { industries: industryMap.affectedIndustries?.map(i => i.industry), needs: needsMap.legalNeeds?.map(n => n.service) }
    });

    for (const entity of affected) {
      for (const need of (needsMap.legalNeeds || []).slice(0, 2)) {
        if (need.confidence < 0.4) continue;
        const id = opportunityId('event_intelligence', entity.id, need.service, [sig.id]);
        if (opportunities.find(o => o.id === id)) continue;
        const urgencyTier = need.urgencyTier || 'this_week';
        const confidence = need.confidence ?? 0.6;
        opportunities.push({
          id,
          type: 'event_driven',
          engineSource: 'event_intelligence',
          entity: entity.id,
          entityType: (workspace.prospects || []).some(p => p.id === entity.id) ? 'prospect' : 'client',
          suggestedService: need.service,
          urgencyTier,
          confidence,
          severity: deriveSeverity({
            urgencyTier, confidence, engine: 'event_intelligence',
            signalSources: [sig.source].filter(Boolean)
          }),
          estimatedRevenue: null,
          competitiveContext: 'moderate',
          score: Math.round(60 + confidence * 35),
          generatedAt: new Date().toISOString(),
          status: 'new',
          statusHistory: [{ status: 'new', changedBy: 'event_engine', changedAt: new Date().toISOString() }],
          notes: '',
          basis: {
            summary: `${industryMap.eventSummary || sig.title} — ${need.rationale}`,
            signalIds: [sig.id],
            matterReferences: (workspace.matters || []).filter(m => m.client === entity.id).slice(0, 2).map(m => m.id),
            reasoning: `Event: ${sig.title}. ${need.rationale}`
          }
        });
        if (opportunities.length >= limit) break;
      }
      if (opportunities.length >= limit) break;
    }
    if (opportunities.length >= limit) break;
  }
  return opportunities;
}
