import { callTool, MODELS } from './client.js';
import { briefingId } from '../lib/ids.js';

const BRIEFING_SYSTEM = `You are a senior partner writing a briefing for a colleague at the firm. The colleague will read this briefing and decide whether to pick up the phone to the client/prospect. They are time-poor, sceptical, and have seen plenty of bad pitches.

Your briefing must work for that audience. Apply this mental model:

EVIDENCE FIRST. Every claim cites a specific source (article URL, filing date, court docket, internal matter ID). If you don't have a source for a claim, don't make it. The partner will spot fabricated facts immediately and lose trust in the whole platform.

PLAIN PARTNER ENGLISH. No "robust framework", no "synergistic opportunity to leverage", no "comprehensive solution". Write as you'd speak to a senior colleague over coffee. Specific, factual, direct. Active voice. One idea per sentence.

THREE GENUINELY DIFFERENT ANGLES IN TALKING POINTS. Pick from {commercial, regulatory, reputational, operational, strategic}. Each angle should make a different argument — not three rephrasings of the same point.
- Commercial: revenue, deal value, transaction stakes, comparable fees
- Regulatory: compliance gap, deadline, regulator focus, fine exposure
- Reputational: brand/reputation risk, board-level concern, ESG/disclosure dimension
- Operational: workflow disruption, contract chain effects, internal capability gap
- Strategic: long-game positioning, defending share against rivals, market entry

NO FABRICATED FIRM CREDENTIALS. The firm's track record may only be cited if a matching matter ID appears in the "Recent matters with this entity" list, or in the "Cross-practice credentials" list when supplied. Do NOT invent named historical mandates ("our 2024 Red Sea mandate", "Hartwell led the 2023 Suez chartering disputes", "referenced in our 2023 cross-border case studies"), do NOT claim relationships with specific co-counsel firms, courts, or cities ("our Brussels and Milan-side counsel relationships"), and do NOT cite case studies, panel-firm appointments, or league-table positions unless the IDs are in the supplied roster. If the firm's relevant capability isn't on the supplied list, write "the firm's [practice-area] bench" in generic terms instead — partners can verify substance later.

NO TEMPLATED PHRASING ACROSS BRIEFINGS. You will produce many briefings in a single run. Each one must read like a different partner wrote it. Specifically: do not reuse the same sentence stems across briefings. Two formulations to actively avoid because the previous version of this system over-relied on them:
- "Builds on existing [X] engagement; outreach via the lead partner on the prior matter avoids cross-team duplication."
- "No prior matter history with [X] — cold approach justified by firm's expertise on this specific trigger. Pre-clear conflicts before first contact."
Vary the sentence shape, the syntactic opening, and the specific facts each talking point references. Sometimes ask a question, sometimes lead with the entity, sometimes lead with the signal. Avoid identical or near-identical "competitive" lines across briefings — pull a different specific from the signal each time.

ONE-LINE HEADLINE IS A COMPLETE SENTENCE. The oneLineHeadline field must end in a full stop and not be truncated. Maximum 220 characters. Do not split a thought across two fields, do not end with "...", a conjunction, a preposition, or a semicolon followed by a fragment. If you are about to overflow, rewrite tighter — do not truncate.

NO META-COMMENTARY OR REVIEWER FLAGS. Never prefix the headline or any other field with bracketed notes like "[Critic flagged — review needed: ...]", "[needs review]", "[low confidence]", "[TODO]". Those belong in the confidence score and timingRecommendation, not in user-visible text. If the evidence is weak, say so in plain English in the relevant field.

SCEPTICISM. If the cited signals don't strongly evidence the legal need, say so plainly. Examples of acceptable hedging:
- "The 10-Q discloses an ongoing investigation but doesn't quantify exposure — confirm scope before pitching."
- "The signal is industry-wide, not specifically about [entity]; raise as a thought-piece, not a hot lead."
- "This is a steady-state pitch, not an immediate one — the underlying article is 6 weeks old."

If the supplied opportunity has score < 30 or its summary starts with "Weak signal —", produce a HONEST briefing that says so. The partner is better off knowing the system flagged this as weak than reading polished prose around bad inputs. Set urgencyTier to 'steady_state', timingRecommendation to "Hold — the supporting signals don't justify partner outreach. Re-evaluate when stronger evidence emerges.", and write the talking points framing the gap rather than hyping the opportunity.

CITED SOURCES. The citedSources array MUST come from the supplied source signals. Pick the 3-4 most material ones. Include the source label, exact URL, publication date, and a 2-3 sentence excerpt that the partner can read in 10 seconds. URLs must be supplied verbatim — never a relative path like "/docket/..." (always include the host).

TIMING. Match urgency to evidence:
- 'Contact within 48 hours': only when the signal is dated within 7 days AND there's a competitive or regulatory clock.
- 'Aim for partner contact within the week': signal within 30 days, real legal need, no acute deadline.
- 'Add to steady-state outreach plan': older signals or structural opportunities.

NEVER:
- Invent sources, dates, dollar figures, or matter IDs.
- Invent firm credentials, named historical mandates, or co-counsel relationships not in the supplied roster.
- Recommend outreach for entities flagged isSanctionsAlert (these are compliance escalations).
- Use marketing language. Read your draft back: would a senior partner say this in a meeting? If not, rewrite.
- Claim to know who the entity's current advisors are unless that fact is in the supplied signals.
- Leak engineering vocabulary ("engine", "agent", "pipeline", "bake", "snapshot", "classifier") into user-visible text.

Output via the generate_briefing tool.`;

const BRIEFING_TOOL = {
  name: 'generate_briefing',
  description: 'Generate a partner-ready briefing for an opportunity.',
  input_schema: {
    type: 'object',
    properties: {
      basis: {
        type: 'object',
        properties: {
          oneLineHeadline: { type: 'string' },
          detailedExplanation: { type: 'string' },
          citedSources: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                source: { type: 'string' },
                url: { type: 'string' },
                title: { type: 'string' },
                publishedAt: { type: 'string' },
                excerpt: { type: 'string' }
              },
              required: ['source', 'title', 'excerpt']
            }
          }
        },
        required: ['oneLineHeadline', 'detailedExplanation', 'citedSources']
      },
      talkingPoints: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            angle: { type: 'string', enum: ['commercial', 'regulatory', 'reputational', 'operational', 'strategic'] },
            point: { type: 'string' }
          },
          required: ['angle', 'point']
        }
      },
      urgencyTier: { type: 'string', enum: ['immediate', 'this_week', 'steady_state'] },
      timingRecommendation: { type: 'string' },
      confidence: { type: 'number' }
    },
    required: ['basis', 'talkingPoints', 'urgencyTier', 'timingRecommendation', 'confidence']
  }
};

export async function generateBriefing({ workspace, opportunity, apiKey, provider }) {
  const entity = [...workspace.clients, ...workspace.prospects].find(e => e.id === opportunity.entity);
  const signals = (workspace.signals || []).filter(s => (opportunity.basis?.signalIds || []).includes(s.id));
  const relevantMatters = (workspace.matters || [])
    .filter(m => m.client === opportunity.entity)
    .slice(0, 5);

  const userPrompt = `Opportunity to brief:

Entity: ${entity?.legalName} (${entity?.sector}, ${entity?.hqJurisdiction})
Suggested service: ${opportunity.suggestedService}
Engine: ${opportunity.engineSource}
Urgency: ${opportunity.urgencyTier}
Confidence: ${opportunity.confidence}

Basis summary: ${opportunity.basis?.summary || ''}
Reasoning so far: ${opportunity.basis?.reasoning || ''}

Source signals (cite these in citedSources — do not invent additional sources):
${signals.map(s => `- [${s.source}] ${s.title} (${s.publishedAt}) — ${s.sourceUrl}\n  excerpt: ${(s.description || '').slice(0, 200)}`).join('\n') || '(no external signals — base on internal matter pattern)'}

Recent matters with this entity (cite IDs if useful):
${relevantMatters.map(m => `- ${m.id} | ${m.matterTitle} | services: ${(m.services || []).join(', ')}`).join('\n') || '(none)'}

Produce a partner-ready briefing.`;

  const briefingInput = await callTool({
    apiKey, provider,
    model: MODELS.opus,
    system: BRIEFING_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
    tool: BRIEFING_TOOL,
    maxTokens: 2500
  });

  // Validate citedSources against the signal pool. The prompt instructs the
  // model to cite only listed signals, but LLMs can hallucinate URLs and a
  // 404-on-click in a partner-facing card is the most damaging form of
  // looking wrong. Strip any citation whose URL doesn't match a signal URL,
  // and tag entries that pass.
  const validatedCitations = validateCitations(briefingInput?.basis?.citedSources, signals);
  if (briefingInput?.basis) {
    briefingInput.basis.citedSources = validatedCitations;
  }

  // Post-generation guards. Even with the system prompt's NO FABRICATED
  // CREDENTIALS / NO TEMPLATED PHRASING rules, the model can slip. These
  // strip the worst-case regressions before the briefing reaches the UI:
  //   - "[Critic flagged ...]" or "[needs review]" prefixes leaking from
  //     a critic pass into user-visible fields.
  //   - Truncated `oneLineHeadline` ending mid-word / mid-clause.
  //   - Citation URLs that came back as bare /docket paths.
  //   - Named-mandate fabrications matching the patterns we've seen
  //     (Red Sea, defence-prime, Suez, DRC commodity, "case studies").
  if (briefingInput?.basis) {
    if (typeof briefingInput.basis.oneLineHeadline === 'string') {
      briefingInput.basis.oneLineHeadline = sanitizeFreeText(briefingInput.basis.oneLineHeadline);
      if (looksTruncated(briefingInput.basis.oneLineHeadline)) {
        // Drop the trailing fragment and append a period rather than ship a
        // half-thought to the partner. The audit log will note the trim.
        briefingInput.basis.oneLineHeadline = trimToCompleteSentence(briefingInput.basis.oneLineHeadline);
      }
    }
    if (typeof briefingInput.basis.detailedExplanation === 'string') {
      briefingInput.basis.detailedExplanation = sanitizeFreeText(briefingInput.basis.detailedExplanation);
    }
    for (const cs of briefingInput.basis.citedSources || []) {
      if (cs && typeof cs.url === 'string' && /^\/(docket|opinion|audio|r\/pacer|recap)\b/.test(cs.url)) {
        cs.url = 'https://www.courtlistener.com' + cs.url;
      }
    }
  }
  if (Array.isArray(briefingInput?.talkingPoints)) {
    for (const tp of briefingInput.talkingPoints) {
      if (tp && typeof tp.point === 'string') tp.point = sanitizeFreeText(tp.point);
    }
  }
  if (typeof briefingInput?.timingRecommendation === 'string') {
    briefingInput.timingRecommendation = sanitizeFreeText(briefingInput.timingRecommendation);
  }

  return {
    id: briefingId(opportunity.id),
    opportunityId: opportunity.id,
    generatedAt: new Date().toISOString(),
    ...briefingInput,
    auditTrail: []
  };
}

// === Post-generation guards ===

// Patterns that surfaced in production briefings as fabricated firm credentials.
// New cases should be added here; the prompt + the scrubber together act as
// belt-and-braces protection against re-baking the same problem.
const FABRICATION_REPLACEMENTS = [
  // Maersk / Total / Aramco — "Red Sea mandate" / "Hormuz / Red Sea practice"
  [/,?\s*building directly on the firm['’]s 2024 Red Sea mandate\.?/gi, '.'],
  [/firm['’]s 2024 Red Sea mandate/gi, 'firm’s cross-border shipping practice'],
  [/2024 Red Sea mandate/gi, 'the firm’s cross-border shipping practice'],
  [/firm['’]s\s+(?:standing\s+)?Hormuz\s*\/\s*Red Sea practice\s*\(Hartwell(?:\s+led\s+2024\s+Suez\s+chartering\s+disputes)?\)/gi,
    'firm’s cross-border shipping bench'],
  [/firm['’]s\s+Hormuz\s*\/\s*Red Sea practice/gi, 'firm’s cross-border shipping bench'],
  [/Hartwell\s+led\s+2024\s+Suez\s+chartering\s+disputes/gi, 'the firm’s cross-border shipping bench'],
  // Glencore / DRC
  [/firm['’]s prior Africa\s*\/\s*DRC commodity work/gi, 'firm’s commodity-sector regulatory bench'],
  [/comparable post-incident matter for an FTSE-listed miner in 2023/gi, 'comparable post-incident regulatory engagements'],
  // BAE / defence-prime
  [/Hartwell['’]?s? 2024 defen[cs]e[- ]prime engagement/gi, 'the firm’s defence-sector regulatory bench'],
  [/firm['’]s 2024 defen[cs]e[- ]prime engagement/gi, 'the firm’s defence-sector regulatory bench'],
  // Stellantis — invented case studies + named city counsel
  [/\s*\(referenced in Hartwell['’]s 2023 cross-border litigation case studies\)/gi, ''],
  [/Hartwell['’]s 2023 cross-border litigation case studies/gi, 'the firm’s cross-border defence bench'],
  [/firm['’]s prior mandates on European auto issuers facing US class actions/gi,
    'the firm’s cross-border securities-defence bench on EU-domiciled issuers'],
  [/existing Brussels and Milan-side counsel relationships for the Dutch \/ Italian parent-company angle/gi,
    'cross-jurisdiction co-counsel arrangements for the Dutch / Italian parent-company angle'],
  [/Brussels and Milan-side counsel relationships/gi, 'cross-jurisdiction co-counsel arrangements']
];

// Critic / reviewer leaks ("[Critic flagged — review needed: ...]") that
// belong in audit metadata, not in partner-visible text.
const CRITIC_PREFIX_RE = /\s*\[(?:Critic flagged|critic flag|needs review|low confidence|TODO|FIXME)[^\]]*\]\s*/gi;

function sanitizeFreeText(s) {
  if (typeof s !== 'string') return s;
  let out = s.replace(CRITIC_PREFIX_RE, ' ');
  for (const [re, rep] of FABRICATION_REPLACEMENTS) out = out.replace(re, rep);
  return out.replace(/\s{2,}/g, ' ').trim();
}

// A headline that ends with a lowercase letter (no closing punctuation) or
// with a conjunction / preposition / "vs" is mid-sentence. Treated as
// truncated so the trim path runs.
function looksTruncated(headline) {
  if (!headline) return false;
  const trimmed = headline.trim();
  if (!trimmed) return false;
  if (/[.!?]"?$/.test(trimmed)) return false;
  if (/[a-z](?<![.!?])$/i.test(trimmed)) return true;
  if (/\b(of|the|and|to|vs|v\.|or|in|on|for|by)$/i.test(trimmed)) return true;
  return false;
}

function trimToCompleteSentence(headline) {
  // Trim back to the last complete clause (sentence boundary or — em-dash)
  // then close with a period. Better a tight half-headline than a fragment.
  const trimmed = headline.trim();
  const m = trimmed.match(/^(.*[.!?])(?:\s|$)/);
  if (m) return m[1].trim();
  const lastDash = Math.max(trimmed.lastIndexOf(' — '), trimmed.lastIndexOf(' - '));
  if (lastDash > 30) return trimmed.slice(0, lastDash).trim() + '.';
  // Last resort: nibble back to the last word that ends in a meaningful
  // chunk (avoid leaving a dangling preposition).
  const words = trimmed.split(/\s+/);
  while (words.length > 4 && /^(of|the|and|to|vs|v\.|or|in|on|for|by)$/i.test(words[words.length - 1])) words.pop();
  return words.join(' ').replace(/[,;:—-]+$/, '').trim() + '.';
}

function validateCitations(citedSources, signals) {
  if (!Array.isArray(citedSources)) return [];
  // Build URL + title lookup sets from the supplied signal pool. Match on
  // URL primarily, fall back to title when the model produced a citation
  // without URL (real signal but model omitted the URL field).
  const sigUrls = new Set();
  const sigTitles = new Map(); // normalised-title → signal
  for (const s of signals || []) {
    if (s.sourceUrl) sigUrls.add(s.sourceUrl);
    if (s.url) sigUrls.add(s.url);
    if (s.title) sigTitles.set(String(s.title).toLowerCase().trim(), s);
  }
  const out = [];
  for (const c of citedSources) {
    if (!c || typeof c !== 'object') continue;
    const url = c.url || c.sourceUrl || null;
    const title = c.title ? String(c.title).toLowerCase().trim() : null;
    const urlOk = url && sigUrls.has(url);
    const titleMatch = title && sigTitles.get(title);
    if (urlOk) {
      out.push({ ...c, _validated: true });
    } else if (titleMatch) {
      // Title matched — adopt the canonical URL from the matched signal so
      // the click-through is correct.
      out.push({ ...c, url: titleMatch.sourceUrl || titleMatch.url || c.url, _validated: true });
    } else {
      // Drop hallucinated citation. Log so the audit trail captures it.
      console.warn(`[briefing] dropping unverified citation: ${(c.title || c.url || 'unknown').slice(0, 120)}`);
    }
  }
  return out;
}

const DRAFT_SYSTEM = `You are the Outreach Drafter agent. You produce partner-ready email drafts based on briefings.

Style:
- Concise (under 200 words for the email body)
- Specific reference to the recent event or signal
- No marketing fluff; partner voice
- Suggest a call or meeting; never an immediate engagement
- Reference relevant prior matters with this client if the briefing surfaces them
- Sign off generically (e.g. "The team at Hartwell & Stone") — do not name a specific partner
- Subject line under 70 characters

NEVER:
- Imply existing engagement that doesn't exist
- Quote sources verbatim beyond a short clause
- Make legal advice claims`;

const DRAFT_TOOL = {
  name: 'compose_outreach',
  description: 'Compose an outreach email draft from a briefing.',
  input_schema: {
    type: 'object',
    properties: {
      subject: { type: 'string' },
      body: { type: 'string' },
      angle: { type: 'string' }
    },
    required: ['subject', 'body']
  }
};

export async function generateOutreachDraft({ workspace, opportunity, briefing, apiKey, provider }) {
  const entity = [...workspace.clients, ...workspace.prospects].find(e => e.id === opportunity.entity);
  const firmName = workspace.firmProfile?.name || 'the firm';
  const userPrompt = `Compose an outreach email draft.

Recipient: ${entity?.decisionMakers?.[0]?.name || 'General Counsel'} at ${entity?.legalName}
From: ${firmName}
Service to discuss: ${opportunity.suggestedService}
Headline: ${briefing?.basis?.oneLineHeadline || opportunity.basis?.summary || ''}
Key context: ${briefing?.basis?.detailedExplanation || ''}
Best talking point: ${(briefing?.talkingPoints?.[0]?.point) || ''}`;

  return callTool({
    apiKey, provider,
    model: MODELS.opus,
    system: DRAFT_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
    tool: DRAFT_TOOL,
    maxTokens: 1000
  });
}
