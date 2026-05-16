// Deterministic heuristic pitch composer — runs when no Anthropic key is
// available. Templates the structure from the top exemplar so the demo
// always has something to render, then layers in opportunity-specific
// details (entity name, signal triggers, suggested partner, etc.).
//
// The output schema matches the LLM agent's schema exactly so the
// frontend renders both the same way.

function prettyService(id) {
  if (!id) return 'the proposed mandate';
  return id.replace(/_/g, ' ');
}
function prettySector(s) {
  if (!s) return '';
  return s.replace(/_/g, ' ');
}

// Pick relevant partners for the credentials section — those whose practice
// areas include the opportunity's practice or whose expertise tags overlap
// with the suggested service. Falls back to any partners + a generic
// "lead partner" sentinel so the docx never renders an empty team block.
function pickTeam(opportunity, partners, practiceArea) {
  const out = [];
  for (const p of partners || []) {
    if (practiceArea && (p.practiceAreas || []).includes(practiceArea)) {
      out.push({
        partnerId: p.id,
        name: p.name,
        role: 'Lead partner',
        rationale: `${p.expertiseTags?.slice(0, 3).join(', ') || 'practice lead'}`
      });
    }
    if (out.length >= 3) break;
  }
  // No exact-PA match — broaden to expertise tags overlapping the service.
  if (!out.length && opportunity?.suggestedService) {
    const svcTokens = String(opportunity.suggestedService).toLowerCase().split('_');
    for (const p of partners || []) {
      const tagHit = (p.expertiseTags || []).some(t =>
        svcTokens.some(tok => tok.length >= 3 && String(t).toLowerCase().includes(tok))
      );
      if (tagHit) {
        out.push({
          partnerId: p.id,
          name: p.name,
          role: 'Lead partner',
          rationale: (p.expertiseTags || []).slice(0, 3).join(', ') || 'practice lead'
        });
      }
      if (out.length >= 3) break;
    }
  }
  // Last-resort fallback so the pitch schema's required `team` array is non-empty.
  if (!out.length && (partners || []).length) {
    const p = partners[0];
    out.push({
      partnerId: p.id, name: p.name, role: 'Lead partner',
      rationale: 'Assigned at instruction; specialist team confirmed on retainer.'
    });
  }
  if (!out.length) {
    out.push({
      partnerId: null,
      name: 'Lead partner — to be confirmed',
      role: 'Lead partner',
      rationale: 'Team assignment confirmed on instruction.'
    });
  }
  return out;
}

// Pick credentials — closed matters in the same practice / sector, recent first.
function pickCredentials(opportunity, matters, entities, practiceArea, sector) {
  const entityById = new Map(entities.map(e => [e.id, e]));
  const candidates = (matters || [])
    .filter(m => m.status === 'closed' || m.status === 'closed_won')
    .filter(m => m.practiceArea === practiceArea || entityById.get(m.client)?.sector === sector)
    .sort((a, b) => (b.endDate || '').localeCompare(a.endDate || ''))
    .slice(0, 4);
  return candidates.map(m => ({
    matterId: m.id,
    matterTitle: m.matterTitle,
    oneLine: `${prettySector(entityById.get(m.client)?.sector)} · ${m.outcome || prettyService(m.services?.[0])}`
  }));
}

export function buildHeuristicPitch({ opportunity, entity, briefing, exemplars, workspace }) {
  const firmName = workspace.firmProfile?.name || 'Hartwell & Stone LLP';
  const service = prettyService(opportunity.suggestedService);
  const sector = entity?.sector;
  const practiceArea = exemplars[0]
    ? (workspace.matters || []).find(m => m.id === exemplars[0].matterId)?.practiceArea
    : null;

  const headline = briefing?.basis?.oneLineHeadline || opportunity.basis?.summary || `${entity?.legalName} — ${service}`;
  const trigger = briefing?.basis?.detailedExplanation
    || opportunity.basis?.reasoning
    || `Recent signals indicate ${entity?.legalName} faces ${service.toLowerCase()} questions worth raising at partner level.`;

  // Voice borrowed from the top exemplar. If we have no exemplars, the
  // text reads as a clean default — still partner-grade English.
  const exemplarVoiceNote = exemplars[0]
    ? ` Modelled on the firm's prior ${prettyService(exemplars[0].tags?.[0]) || 'analogous'} engagement.`
    : '';

  return {
    title: `${firmName} — ${service} pitch · ${entity?.legalName || 'Prospective client'}`,
    executiveSummary:
      `${firmName} proposes to act for ${entity?.legalName} on ${headline}. ` +
      `Our scope addresses the immediate ${service} response with a co-ordinated team across the relevant practice areas.${exemplarVoiceNote}`,
    whyNow:
      `${trigger} The window to act before counterparty positions harden is narrow — typically four to eight weeks ` +
      `from when the trigger first lands. Engaging now preserves both the legal position and the commercial relationships.`,
    whyUs:
      `${firmName} has run similar mandates across the relevant practice and sector. We pair the lead disputes / transactional team with ` +
      `regulatory and tax cover so structural decisions remain coherent throughout the engagement, rather than fragmenting into siloed advice.`,
    team: pickTeam(opportunity, workspace.partners || [], practiceArea),
    credentials: pickCredentials(opportunity, workspace.matters || [],
      [...(workspace.clients || []), ...(workspace.prospects || [])], practiceArea, sector),
    scope: [
      `Initial position-paper on the ${service.toLowerCase()} question.`,
      `Counterparty / regulator engagement plan with a phased timetable.`,
      `Documentary review and risk allocation.`,
      `Quarterly board memo as the engagement progresses.`
    ],
    approach: [
      `Day 1-14: scope and stakeholder mapping; initial position paper.`,
      `Week 3-6: counterparty / regulator engagement.`,
      `Week 6+: resolution path (settlement, structural fix, or proceedings).`
    ],
    feesNote:
      `Indicative phased fee — fixed-fee phase 1 followed by time-charged phases with disclosed monthly caps. ` +
      `Side letters drafted around any second-request or contentious-step scenarios.`,
    exemplarPitchIds: exemplars.map(e => e.id),
    generationMode: 'heuristic'
  };
}
