function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const MAX_NAME_LEN = 80;        // guard against runaway-long inputs (ReDoS-adjacent)
const MAX_TEXT_LEN = 20000;     // bound the haystack so scanning is O(names × bounded)

// Word-boundary regex (\bX\b) on its own handles substring collisions like
// "BP" not matching "BPS-Sberbank". The remaining risk is short aliases that
// are also common English words ("Total", "Chase") or generic letter combos
// ("EU", "US"). Rather than rejecting these outright, we mark them as
// "ambiguous" — they pass through the alias index but get the same
// requires-corroboration treatment as 2-char tickers. This way the prospect
// "Wise plc" still links when an article repeatedly mentions "Wise" (likely
// about the fintech) but doesn't fire on a single passing mention of "wise"
// in unrelated copy.
const COMMON_WORD_BLACKLIST = new Set([
  'total', 'chase', 'wise', 'rolls', 'royce',
  'eu', 'us', 'usa', 'uk',
  'sec', 'fca', 'doj', 'ftc'
]);
export function isAmbiguousAlias(name) {
  if (typeof name !== 'string' || !name.length) return false;
  if (/[\s.&'\-]/.test(name)) return false;  // multi-token names are not ambiguous
  return COMMON_WORD_BLACKLIST.has(name.toLowerCase()) || name.length <= 2;
}
function isSafeAlias(name) {
  if (typeof name !== 'string' || !name.length) return false;
  // Names with whitespace / punctuation are inherently distinctive.
  if (/[\s.&'\-]/.test(name)) return true;
  // Single-token aliases of length >= 2 are allowed in the index. Ambiguous
  // ones (blacklist words / 2-char tickers) get demoted to requires-
  // corroboration in the alias index below.
  return name.length >= 2;
}

function buildAliasIndex(entities, type) {
  const out = [];
  for (const e of entities || []) {
    if (!e || typeof e.legalName !== 'string') continue;
    const names = [e.legalName, ...(Array.isArray(e.knownAliases) ? e.knownAliases : [])]
      .filter(n => typeof n === 'string' && n.length > 0 && n.length <= MAX_NAME_LEN)
      .filter(isSafeAlias);
    for (const name of names) {
      // 2-character aliases (BP, VW, GS, MS, GM, AZ) are ambiguous on their
      // own — they collide with everyday usage (blood pressure, multiple
      // sclerosis, Arizona, etc.). Require corroboration before linking;
      // the rule is now applied in two stages in linkEntities (a) accept
      // when another distinct alias of the same entity also matches, OR
      // (b) accept when the 2-char alias appears ≥2 times in the same text
      // (self-corroboration via repeat mention). Stage (b) is what catches
      // real BP/HSBC/Maersk articles that say only "BP" 5-10 times and
      // never spell out "BP plc".
      // Corroboration is required for any "ambiguous" alias: 2-char tickers
      // AND single-token aliases that are common English words / regulator
      // codes (Wise, Total, Chase, EU, etc). The full legalName itself never
      // requires corroboration.
      const requiresCorroboration = name !== e.legalName && isAmbiguousAlias(name);
      // Global regex so we can count occurrences via matchAll.
      out.push({
        regex: new RegExp(`\\b${escapeRegex(name)}\\b`, 'gi'),
        entityId: e.id,
        entityType: type,
        mention: name,
        requiresCorroboration
      });
    }
  }
  return out;
}

export function linkEntities(text, clients, prospects) {
  if (typeof text !== 'string' || !text) return [];
  const haystack = text.length > MAX_TEXT_LEN ? text.slice(0, MAX_TEXT_LEN) : text;
  const index = [
    ...buildAliasIndex(clients || [], 'client'),
    ...buildAliasIndex(prospects || [], 'prospect')
  ];
  // First pass: count distinct matching aliases per entity AND total
  // occurrences of each alias. A weak (2-char) alias accepts when either:
  //   (a) another distinct, non-weak alias of the same entity also matches, OR
  //   (b) the weak alias itself appears ≥2 times in the same text.
  const hitsByEntity = new Map(); // entityId → { entityType, mentions: Set, hadStrong: bool, weakSelfCorrob: bool }
  for (const entry of index) {
    // matchAll on a /g regex gives occurrence counts; bail at 2 to save work.
    let count = 0;
    for (const _ of haystack.matchAll(entry.regex)) {
      count++;
      if (count >= 2) break;
    }
    if (count === 0) continue;
    if (!hitsByEntity.has(entry.entityId)) {
      hitsByEntity.set(entry.entityId, {
        entityType: entry.entityType,
        mentions: new Set(),
        hadStrong: false,
        weakSelfCorrob: false
      });
    }
    const rec = hitsByEntity.get(entry.entityId);
    rec.mentions.add(entry.mention);
    if (!entry.requiresCorroboration) rec.hadStrong = true;
    else if (count >= 2) rec.weakSelfCorrob = true;
  }
  const found = new Map();
  for (const [entityId, rec] of hitsByEntity.entries()) {
    // Accept entity only when corroborated. A weak alias on its own with
    // a single mention is rejected; weak alias with ≥2 occurrences OR a
    // companion strong-alias match is accepted.
    if (!rec.hadStrong && !rec.weakSelfCorrob) continue;
    // Pick the longest matched mention as the canonical mentionedAs.
    const mention = [...rec.mentions].sort((a, b) => b.length - a.length)[0];
    found.set(entityId, {
      entityType: rec.entityType,
      entityId,
      mentionedAs: mention,
      confidence: rec.hadStrong ? 0.92 : 0.78
    });
  }
  return Array.from(found.values());
}

export function findEntityById(workspace, id) {
  if (!workspace || !id) return null;
  return (workspace.clients || []).find(c => c.id === id)
      || (workspace.prospects || []).find(p => p.id === id)
      || null;
}

export function findEntityByName(workspace, name) {
  if (!workspace || typeof name !== 'string') return null;
  const lc = name.toLowerCase();
  const inList = list => (list || []).find(e =>
    typeof e?.legalName === 'string' && (
      e.legalName.toLowerCase() === lc ||
      (Array.isArray(e.knownAliases) && e.knownAliases.some(a => typeof a === 'string' && a.toLowerCase() === lc))
    ));
  return inList(workspace.clients) || inList(workspace.prospects) || null;
}
