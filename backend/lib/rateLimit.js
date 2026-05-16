// Per-key fixed-window rate limiter. In-memory — fine for the single-process
// sql.js deployment we run on; would need a shared store (Redis) for any
// multi-process setup. Used to protect LLM-invoking endpoints from being
// hammered by anonymous demo users (every request costs real money + tokens).
const _buckets = new Map();

function purgeExpired(now) {
  for (const [key, b] of _buckets) {
    if (b.resetAt <= now) _buckets.delete(key);
  }
}

export function rateLimit({ windowMs, max, keyFn, name = 'rate' }) {
  return (req, res, next) => {
    const now = Date.now();
    // Cheap periodic GC so the map can't grow forever even if keys are unique.
    if (_buckets.size > 1000) purgeExpired(now);
    const key = `${name}:${keyFn(req)}`;
    let b = _buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      _buckets.set(key, b);
    }
    b.count += 1;
    const remaining = Math.max(0, max - b.count);
    const retryAfterSec = Math.ceil((b.resetAt - now) / 1000);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(b.resetAt / 1000)));
    if (b.count > max) {
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        error: 'rate_limited',
        message: `Too many requests. Retry in ${retryAfterSec}s.`
      });
    }
    next();
  };
}

// Key by user id when authenticated; fall back to IP. The req.ip read trusts
// Express's default — when deployed behind a proxy like Render, the user
// should configure `app.set('trust proxy', 1)` so this resolves to the real
// client IP instead of the proxy's.
export function userOrIpKey(req) {
  if (req.user?.id) return `u:${req.user.id}`;
  return `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
}

// Convenience preset for LLM endpoints: 30 requests / 5 min / user.
export const llmRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  keyFn: userOrIpKey,
  name: 'llm'
});
