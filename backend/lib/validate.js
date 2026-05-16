// Tiny validation helpers — small, explicit, no external dep needed.

export function pick(obj, allowedKeys) {
  if (!obj || typeof obj !== 'object') return {};
  const out = {};
  for (const k of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  }
  return out;
}

export function isString(v, { max = 200 } = {}) {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

export function isOneOf(v, allowed) {
  return allowed.includes(v);
}

export function isStringArray(v, { max = 50 } = {}) {
  return Array.isArray(v) && v.length <= max && v.every(x => typeof x === 'string' && x.length <= 200);
}

export function badRequest(res, msg) {
  return res.status(400).json({ error: msg });
}
