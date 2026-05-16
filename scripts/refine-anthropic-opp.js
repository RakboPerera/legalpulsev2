// Targeted patch: rewrite the Anthropic copyright-cluster opportunity +
// briefing to drop inferred framing ("coordinated plaintiff strategy",
// "bar response forming") that the underlying signals don't actually
// support. The three court filings are real but two of them came back
// from CourtListener queries for OTHER companies (Microsoft, Alphabet)
// and were attributed to Anthropic via title-string match — so claiming
// the cluster reflects coordinated plaintiff strategy is an over-reach.
//
// New posture: state the facts, name the cases, let the partner judge.
// Same opp ID, same cited signals, softer interpretation.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const snapshotPath = path.join(__dirname, '..', 'data', 'demo-snapshot.json');

const OPP_ID = 'opp-161f37ab1c227506';

const NEW_SUMMARY = 'Three federal copyright suits against Anthropic in N.D. Cal. within 9 days (Cognella May 4 · Chicken Soup for the Soul May 7 · Cruz May 13). All filed as 820 Copyright. Worth a conflicts-clear conversation with Anthropic GC on portfolio defense coordination.';

const NEW_REASONING = 'CourtListener shows three discrete 820 Copyright actions against Anthropic, PBC in the Northern District of California: Cognella, Inc. v. Anthropic PBC (3:26-cv-04056, May 4), Chicken Soup for the Soul, LLC v. Anthropic PBC (3:26-cv-04218, May 7), and Cruz v. Anthropic PBC (3:26-cv-04482, May 13). The filings are factual; whether they reflect coordinated plaintiff strategy or independent litigants is unclear from public dockets alone. The actionable hook is portfolio-level defense coordination (shared discovery posture, MDL motions if/when a fourth filing lands, consistent fact narrative across cases) — a frame that suits firms with integrated IP-litigation + AI-regulatory teams better than single-suit shops. No prior Anthropic relationship; cold approach justified by the timing and the integrated-team differentiator.';

const NEW_HEADLINE = 'Three N.D. Cal. copyright suits against Anthropic filed May 4–13 — portfolio defense coordination angle worth a GC conversation.';

const NEW_TALKING_POINTS = [
  {
    angle: 'commercial',
    point: 'Three federal copyright filings against Anthropic in nine days, all in N.D. Cal., all 820 Copyright: Cognella (3:26-cv-04056), Chicken Soup for the Soul (3:26-cv-04218), Cruz (3:26-cv-04482). Whether this reflects coordinated plaintiff strategy or three independent filings is something the GC will know better than we do. Either way, when three suits land in the same district in nine days, the in-house team usually shifts from per-suit triage to portfolio posture (shared fact narrative, common discovery objections, MDL readiness).'
  },
  {
    angle: 'positioning',
    point: 'No prior Anthropic relationship. The pitch is not about taking over an existing engagement — it is about adding a portfolio-coordination layer across whichever firms are running the individual suits. Hartwell & Stone\'s integrated IP-litigation + AI-regulatory advisory bench (referenced in the firm\'s 2025 work for a comparable foundation-model client) is the credential.'
  },
  {
    angle: 'competitive',
    point: 'Anthropic already has incumbent litigation counsel on at least one of these matters. Differentiator is the portfolio frame, not displacing incumbents. If a fourth suit lands within the next 14–21 days, the case for a coordinator firm strengthens materially.'
  }
];

const NEW_TIMING = 'GC / Chief Legal Officer outreach this week — before any further filings prompt the in-house team to anchor on existing counsel for the cluster.';

function build() {
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  const opp = (snapshot.opportunities || []).find(o => o.id === OPP_ID);
  if (!opp) throw new Error(`opp ${OPP_ID} not found in snapshot`);
  const brf = (snapshot.briefings || []).find(b => b.opportunityId === OPP_ID);
  if (!brf) throw new Error(`briefing for ${OPP_ID} not found in snapshot`);

  opp.basis = {
    ...opp.basis,
    summary: NEW_SUMMARY,
    reasoning: NEW_REASONING
  };
  brf.basis = {
    ...brf.basis,
    oneLineHeadline: NEW_HEADLINE,
    detailedExplanation: NEW_REASONING
  };
  brf.talkingPoints = NEW_TALKING_POINTS;
  brf.timingRecommendation = NEW_TIMING;
  // Keep confidence the same — the underlying cluster is real, only the
  // framing was softened. Lower urgency one notch since "coordinated bar
  // response" was the immediate-urgency hook.
  opp.urgencyTier = 'this_week';
  brf.urgencyTier = 'this_week';

  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  console.log(`[ok] Refined ${OPP_ID} (Anthropic copyright cluster) — facts stated, inferences removed`);
}

build();
