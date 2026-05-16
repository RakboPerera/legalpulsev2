import { clusterClients, buildClientServiceMatrix, findServiceGaps } from '../lib/clustering.js';
import { opportunityId } from '../lib/ids.js';
import { addAuditEntry } from '../lib/audit.js';
import { analyzeCrossSellGap } from '../agents/crossSellAnalyzer.js';
import { deriveSeverity } from '../lib/severity.js';

export async function runCrossSellEngine({ workspace, apiKey, provider, limit = 30 }) {
  const clusters = clusterClients(workspace.clients);
  const matrix = buildClientServiceMatrix(workspace.clients, workspace.matters);
  const opportunities = [];

  for (const cluster of clusters) {
    // Skip 1-2 member clusters — peer-adoption math degenerates to 100% on
    // n=1 peer, surfacing every service a single peer happens to use as
    // "100% adopted by peers". Bake-demo had this guard inline; centralise here.
    if (cluster.members.length < 3) continue;

    for (const clientId of cluster.members) {
      const client = workspace.clients.find(c => c.id === clientId);
      // Require a strong peer pattern (>=66%) — matches the bake's threshold
      // so runtime and bake produce comparable cross-sell quality.
      const gaps = findServiceGaps(clientId, matrix, cluster).filter(g => g.penetration >= 0.66);
      if (!gaps.length) continue;

      // "Recent" by publish date, not array-order. .slice(-5) gave us the
      // last-INGESTED signals which on a fresh bake means newest, but on an
      // existing workspace produces whatever order the persistence layer
      // happens to return.
      const recentSignals = (workspace.signals || [])
        .filter(s => (s.entities || []).some(e => e.entityId === clientId))
        .slice()
        .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
        .slice(0, 5);

      const top = gaps.slice(0, 3);
      let pick;
      try {
        pick = await analyzeCrossSellGap({
          client, gaps: top, partners: workspace.partners, recentSignals, apiKey, provider
        });
      } catch (err) {
        console.warn(`[crossSell] analyzer failed for ${clientId}: ${err.message}`);
        pick = { pickedService: top[0].service, rationale: `Top gap by penetration (${(top[0].penetration*100).toFixed(0)}%)`, confidence: 0.6, urgencyTier: 'steady_state' };
      }

      const id = opportunityId('cross_sell', clientId, pick.pickedService, []);
      const urgencyTier = pick.urgencyTier || 'steady_state';
      const confidence = pick.confidence ?? 0.6;
      opportunities.push({
        id,
        type: 'cross_sell',
        engineSource: 'cross_sell',
        entity: clientId,
        entityType: 'client',
        suggestedService: pick.pickedService,
        urgencyTier,
        confidence,
        severity: deriveSeverity({ urgencyTier, confidence, engine: 'cross_sell' }),
        estimatedRevenue: null,
        competitiveContext: 'moderate',
        score: Math.round(50 + confidence * 40 + (top[0].penetration * 10)),
        generatedAt: new Date().toISOString(),
        status: 'new',
        statusHistory: [{ status: 'new', changedBy: 'cross_sell_engine', changedAt: new Date().toISOString() }],
        notes: '',
        basis: {
          summary: pick.rationale,
          signalIds: recentSignals.map(s => s.id),
          matterReferences: (workspace.matters || []).filter(m => m.client === clientId).slice(0, 3).map(m => m.id),
          reasoning: pick.rationale
        }
      });
      addAuditEntry(workspace, {
        type: 'engine_run',
        actor: 'cross_sell_engine',
        inputs: { clientId, gaps: top.map(g => g.service) },
        outputs: { picked: pick.pickedService, confidence: pick.confidence }
      });

      if (opportunities.length >= limit) break;
    }
    if (opportunities.length >= limit) break;
  }
  return opportunities;
}
