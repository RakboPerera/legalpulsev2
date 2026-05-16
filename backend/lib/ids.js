import { createHash, randomUUID } from 'crypto';

export function deterministicId(prefix, ...parts) {
  const hash = createHash('sha256').update(parts.map(p => String(p ?? '')).join('|')).digest('hex').slice(0, 16);
  return `${prefix}-${hash}`;
}

// Strip tracking / session params and trailing slashes so that the same
// article reached via two URLs (?utm_source=newsletter, &fbclid=...) hashes
// to the same signal id. Conservative — only known tracking keys are
// stripped; structural query params (?id=, ?article=) stay.
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref', '_ga', 'ref_src', 'igshid',
  'cmpid', 'mod', 'mkt_tok', 'src', 'cid'
]);
function canonicalizeUrl(url) {
  if (!url || typeof url !== 'string') return url;
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(k.toLowerCase())) u.searchParams.delete(k);
    }
    u.hash = '';
    let out = u.toString();
    if (out.endsWith('/') && u.pathname !== '/') out = out.slice(0, -1);
    return out;
  } catch {
    return url;
  }
}

// Stable across re-bakes: hash on (source, canonical-url) only. URL is the
// canonical key for a unique signal across all sources we currently use.
// Including a publication or crawl date here would mean the same article
// re-baked next week produces a different ID, which breaks deduplication
// and snapshot diffs.
export function signalId(entityName, source, url, _publishedAt) {
  return deterministicId('sig', source, canonicalizeUrl(url) || entityName);
}

export function opportunityId(engine, entityId, serviceId, signalIds = []) {
  return deterministicId('opp', engine, entityId, serviceId, [...signalIds].sort().join(','));
}

export function briefingId(opportunityIdValue) {
  return deterministicId('brf', opportunityIdValue);
}

export { randomUUID };
