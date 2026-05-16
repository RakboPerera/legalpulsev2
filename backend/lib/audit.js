import { randomUUID } from 'crypto';

export function addAuditEntry(state, { type, actor, inputs, outputs, sourceReferences }) {
  const entry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    type,
    actor,
    inputs: inputs ?? null,
    outputs: outputs ?? null,
    sourceReferences: sourceReferences ?? []
  };
  state.auditTrail = state.auditTrail || [];
  state.auditTrail.push(entry);
  if (state.auditTrail.length > 5000) {
    state.auditTrail = state.auditTrail.slice(-5000);
  }
  return entry;
}

function matchesEntityId(entry, entityId) {
  // Walk inputs/outputs once instead of JSON.stringify'ing them, so we don't
  // false-match on quoted JSON noise like `"x":"<entityId-substring>"`.
  const visit = v => {
    if (v == null) return false;
    if (typeof v === 'string') return v === entityId;
    if (typeof v !== 'object') return false;
    if (Array.isArray(v)) return v.some(visit);
    return Object.values(v).some(visit);
  };
  return visit(entry.inputs) || visit(entry.outputs);
}

export function auditFilter(entries, { type, since, until, entityId, source, limit = 200, offset = 0 } = {}) {
  let out = entries;
  if (type) out = out.filter(e => e.type === type);
  if (since) out = out.filter(e => e.timestamp >= since);
  if (until) out = out.filter(e => e.timestamp <= until);
  if (entityId) out = out.filter(e => matchesEntityId(e, entityId));
  if (source) out = out.filter(e =>
    (e.sourceReferences || []).some(r => r.source === source));
  // Show most-recent first; apply offset/limit on the reversed sequence.
  const reversed = out.slice().reverse();
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 200));
  return {
    total: out.length,
    entries: reversed.slice(safeOffset, safeOffset + safeLimit)
  };
}
