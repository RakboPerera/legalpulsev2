// Heuristic retrieval over the firm's historical pitch corpus.
//
// Given an opportunity (entity + suggested service + practice area), find the
// top-K prior pitches whose tags, practice, sector, and recency best match.
// No embeddings — a tag-overlap + recency-weighted scorer that runs in <1ms.
// Sufficient for a corpus of 15-50 pitches; can be swapped for embedding
// similarity later if the corpus grows past ~100 documents.
//
// The retrieved exemplars are surfaced to the partner BEFORE generation so
// they can see what the pitch agent is learning from — and to the agent
// itself as system-prompt material. Both transparency wins.

// Resolve the practice area for a service id by walking the service taxonomy.
function practiceFor(serviceTaxonomy, serviceId) {
  if (!serviceId || !serviceTaxonomy?.practiceAreas) return null;
  for (const [paId, paBlock] of Object.entries(serviceTaxonomy.practiceAreas)) {
    if ((paBlock.services || []).some(s => s.id === serviceId)) return paId;
  }
  return null;
}

// Days between two ISO dates. Returns Infinity if either is missing.
function daysBetween(aIso, bIso) {
  const a = aIso ? new Date(aIso).getTime() : NaN;
  const b = bIso ? new Date(bIso).getTime() : NaN;
  if (isNaN(a) || isNaN(b)) return Infinity;
  return Math.abs(b - a) / 86400000;
}

// Score a single pitch against the opportunity context. Higher = better match.
//   + 5 if same service id exactly appears in the pitch's tags
//   + 3 if the pitch's matter is in the same practice area
//   + 2 if the pitch's matter is for the same sector
//   + 1 per shared tag beyond the first
//   + recency boost up to 3 points (newer pitches outrank older ones)
//   - penalty if the pitch references the same client (would feel like
//     re-using the previous pitch verbatim — partners notice)
function scorePitch(pitch, ctx) {
  let score = 0;
  const reasons = [];
  const tags = new Set(pitch.tags || []);

  if (ctx.serviceId && tags.has(ctx.serviceId)) {
    score += 5;
    reasons.push(`Same service (${ctx.serviceId})`);
  }

  const matter = ctx.matterById.get(pitch.matterId);
  if (matter) {
    if (ctx.practiceArea && matter.practiceArea === ctx.practiceArea) {
      score += 3;
      reasons.push(`Same practice (${ctx.practiceArea})`);
    }
    const matterSector = ctx.entityById.get(matter.client)?.sector;
    if (ctx.sector && matterSector === ctx.sector) {
      score += 2;
      reasons.push(`Same sector (${ctx.sector})`);
    }
    if (matter.client === ctx.entityId) {
      score -= 2;
      reasons.push('Same client — would re-quote');
    }
  }

  // Shared tag count beyond the explicit service match.
  const otherShared = (ctx.signalTags || []).filter(t => t !== ctx.serviceId && tags.has(t));
  if (otherShared.length) {
    score += Math.min(otherShared.length, 3);
    reasons.push(`Shared tags: ${otherShared.join(', ')}`);
  }

  // Recency. Pitches in the last 12 months get the full 3 points; older
  // decay linearly to zero at 36 months.
  if (pitch.dateAuthored) {
    const ageDays = daysBetween(pitch.dateAuthored, ctx.now);
    const recencyBoost = Math.max(0, 3 - Math.max(0, (ageDays - 365)) / 365 * 3);
    score += recencyBoost;
  }

  return { score: Math.round(score * 10) / 10, reasons };
}

export function retrieveSimilarPitches({ opportunity, entity, workspace, k = 4 }) {
  const pitches = workspace.pitches || [];
  if (!pitches.length) return [];

  const serviceId    = opportunity.suggestedService;
  const practiceArea = practiceFor(workspace.serviceTaxonomy, serviceId);
  const sector       = entity?.sector;
  const entityId     = opportunity.entity;
  const signalTags   = []; // placeholder for richer tag extraction later

  const matterById = new Map((workspace.matters || []).map(m => [m.id, m]));
  const entityById = new Map([
    ...(workspace.clients || []),
    ...(workspace.prospects || [])
  ].map(e => [e.id, e]));

  const ctx = {
    serviceId, practiceArea, sector, entityId, signalTags,
    matterById, entityById,
    now: new Date().toISOString()
  };

  const scored = pitches.map(p => {
    const { score, reasons } = scorePitch(p, ctx);
    return { pitch: p, score, reasons };
  });

  // Filter out anything that scored 0 — completely unrelated to the
  // opportunity. Then sort by descending score and take top-k.
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(s => ({
      id:           s.pitch.id,
      matterId:     s.pitch.matterId,
      title:        s.pitch.title,
      dateAuthored: s.pitch.dateAuthored,
      tags:         s.pitch.tags,
      sections:     s.pitch.sections,
      matchScore:   s.score,
      matchReasons: s.reasons
    }));
}
