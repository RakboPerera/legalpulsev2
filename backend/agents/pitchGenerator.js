import { callTool, MODELS } from './client.js';

// The Pitch Generator agent — Opus, BYOK. Takes the opportunity, the entity,
// the supporting briefing (if any), and the top 3-4 retrieved exemplar
// pitches, and produces a structured pitch document in the firm's voice.
//
// Key behaviours encoded in the system prompt:
//   - Mirror the tone, headings, and length conventions of the supplied
//     exemplars. Don't invent a new voice.
//   - Cite real partners from the supplied roster — never invent.
//   - Cite real prior matters from the supplied credentials list — never
//     fabricate a track record.
//   - Be sceptical: if the opportunity has score < 30 or a "Weak signal —"
//     prefix, the pitch should flag the limited supporting evidence rather
//     than gloss over it. Pitching weak signals damages the firm's standing.

const SYSTEM_PROMPT = `You are a senior partner drafting a business-development pitch for a colleague to send to a prospective or existing client. The output will be exported to a Word document and forwarded under the firm's letterhead — so it must read as partner-grade English, not marketing copy.

Hard rules:

1. VOICE FROM THE EXEMPLARS. You will be supplied 2-4 prior pitches that the firm has used on analogous matters. Mirror their tone, section length, and phrasing conventions. If the exemplars are terse and factual, be terse and factual. Do not invent a new voice.

2. NO FABRICATED CREDENTIALS. The "credentials" section MUST cite real matters from the supplied roster — by matter ID. Do not invent client names, deal sizes, or outcomes. If a credential isn't in the supplied list, do not claim it.

3. NO FABRICATED TEAM. The "team" section MUST cite real partners from the supplied roster — by partner ID and name. Do not invent a partner. If a relevant specialist isn't on the roster, say so honestly ("Specialist counsel briefed from a long-standing referral arrangement" — not "Dr Jane Smith of our XYZ practice").

4. PLAIN PARTNER ENGLISH. No "synergistic", "robust framework", "leverage relationships", "best-in-class", or "comprehensive solution". Specific, factual, active voice. One idea per sentence.

5. SCEPTICISM ON WEAK INPUTS. If the supplied opportunity has score < 30, or its basis.summary starts with "Weak signal —", you must mirror that scepticism in the pitch. The pitch should flag that the supporting evidence is thin, not gloss over it. A partner who pitches a weak signal undermines the firm's standing with the client.

6. SCOPE THAT FITS. The "scope" array should describe what the firm will actually do, not a generic checklist. 3-5 bullets, each starting with a concrete verb (Review / Negotiate / File / Draft / Co-ordinate). Exclude items priced separately.

7. WHY NOW. The "whyNow" section must reference a specific trigger — the signal that surfaced this opportunity, a deadline, a competitive clock — not generic urgency.

8. FEES NOTE. One paragraph. Indicative phased structure, soft cap, partner-to-GC review cadence. Never quote a specific number unless one was given to you in the input.

Output via the generate_pitch tool.`;

const PITCH_TOOL = {
  name: 'generate_pitch',
  description: 'Produce a structured pitch document for the given opportunity.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      executiveSummary: { type: 'string' },
      whyNow:           { type: 'string' },
      whyUs:            { type: 'string' },
      team: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            partnerId: { type: 'string' },
            name:      { type: 'string' },
            role:      { type: 'string' },
            rationale: { type: 'string' }
          },
          required: ['partnerId', 'name', 'role']
        }
      },
      credentials: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            matterId:    { type: 'string' },
            matterTitle: { type: 'string' },
            oneLine:     { type: 'string' }
          },
          required: ['matterId', 'oneLine']
        }
      },
      scope:    { type: 'array', items: { type: 'string' } },
      approach: { type: 'array', items: { type: 'string' } },
      feesNote: { type: 'string' },
      exemplarPitchIds: { type: 'array', items: { type: 'string' } }
    },
    required: ['title', 'executiveSummary', 'whyNow', 'whyUs', 'team', 'credentials', 'scope', 'approach', 'feesNote']
  }
};

function renderExemplar(p) {
  const s = p.sections || {};
  return `EXEMPLAR ${p.id} (matter ${p.matterId}, authored ${p.dateAuthored || 'undated'})
Tags: ${(p.tags || []).join(', ')}
Title: ${p.title}
Executive summary: ${s.executiveSummary || ''}
Why now: ${s.whyNow || ''}
Why us: ${s.whyUs || ''}
Team: ${s.team || ''}
Credentials: ${s.credentials || ''}
Scope: ${s.scope || ''}
Fees: ${s.fees || ''}`;
}

export async function generatePitch({ workspace, opportunity, entity, briefing, exemplars, partnersRoster, credentialsRoster, apiKey, provider }) {
  const firmName = workspace.firmProfile?.name || 'Hartwell & Stone LLP';
  const exemplarBlock = (exemplars || []).map(renderExemplar).join('\n\n---\n\n')
    || '(no exemplars retrieved — match by tone with general partner-pitch conventions)';

  const partnersList = (partnersRoster || []).map(p =>
    `- ${p.id} · ${p.name} · ${(p.practiceAreas || []).join(', ')} · expertise: ${(p.expertiseTags || []).join(', ')}`
  ).join('\n') || '(roster empty)';

  const credentialsList = (credentialsRoster || []).map(m =>
    `- ${m.id} · ${m.matterTitle} · practice ${m.practiceArea} · outcome: ${m.outcome || 'closed'}`
  ).join('\n') || '(none — no relevant prior matters in this practice)';

  const userPrompt = `Compose a business-development pitch document for:

Firm: ${firmName}
Target entity: ${entity?.legalName} (${entity?.sector}, HQ ${entity?.hqJurisdiction}, ${entity?.size})
Entity type: ${opportunity.entityType === 'prospect' ? 'PROSPECT (no prior relationship with the firm)' : 'EXISTING CLIENT'}
Suggested service: ${opportunity.suggestedService}
Urgency: ${opportunity.urgencyTier}
Opportunity score: ${opportunity.score}
Opportunity summary: ${opportunity.basis?.summary || ''}
Opportunity reasoning: ${opportunity.basis?.reasoning || ''}

${briefing ? `BRIEFING CONTEXT:
Headline: ${briefing.basis?.oneLineHeadline || ''}
Detail: ${briefing.basis?.detailedExplanation || ''}
Timing recommendation: ${briefing.timingRecommendation || ''}
` : ''}

PARTNERS ROSTER (cite only these — by id and name):
${partnersList}

CREDENTIALS ROSTER — recent closed matters in this practice / sector that you may cite:
${credentialsList}

PRIOR PITCHES TO MIRROR THE VOICE OF:
${exemplarBlock}

Compose the pitch. Mirror the exemplars' tone, length, and structure. Cite only the supplied partners and credentials.`;

  const out = await callTool({
    apiKey, provider,
    model: MODELS.opus,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    tool: PITCH_TOOL,
    maxTokens: 3000
  });

  return {
    ...out,
    exemplarPitchIds: out.exemplarPitchIds || (exemplars || []).map(e => e.id),
    generationMode: 'llm'
  };
}
