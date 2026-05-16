// Normalise entity names so trivial differences ("Apple Inc.", "Apple, Inc")
// don't cause false negatives. Strip common corporate suffixes and punctuation,
// collapse whitespace, lowercase.
const SUFFIX_RE = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|llp|lp|plc|gmbh|ag|sa|nv|bv|kg|kgaa|holdings?|group|the)\b\.?/gi;

function normalize(name) {
  if (typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .replace(SUFFIX_RE, ' ')
    .replace(/[.,'"()&/\\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Word-boundary aware matcher. Returns true when one name is a substring of
// the other AT a word boundary — so "Apple" matches "Apple Holdings" but not
// "Pineapple Co", and "BP" doesn't match every "bp" inside another word.
function wordContains(haystack, needle) {
  if (!haystack || !needle) return false;
  if (haystack === needle) return true;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(haystack);
}

export function checkConflicts(state, entityName) {
  const conflicts = state.conflicts || [];
  const target = normalize(entityName);
  const hits = conflicts.filter(c => {
    const candidate = normalize(c.entityName);
    if (!candidate || !target) return false;
    return candidate === target ||
      wordContains(target, candidate) ||
      wordContains(candidate, target);
  });
  return {
    entityName,
    conflicted: hits.length > 0,
    hits
  };
}
