import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { encryptSecret, decryptSecret } from '../lib/secrets.js';
import { SUPPORTED_PROVIDERS, isValidProvider, validateProviderKey } from '../lib/llm/index.js';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const ANON_DOMAIN = '@anon.legalpulse.local';

// Per-provider expected key prefix. Used for a cheap pre-validation gate
// before we burn a real API call on key verification — catches typos
// (e.g. pasting an Anthropic key into the OpenAI slot).
const PROVIDER_KEY_PREFIXES = {
  anthropic: 'sk-ant-',
  openai: 'sk-',
  deepseek: 'sk-'
};

function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
    path: '/'
  };
}

export function createAuthRouter(db) {
  const router = Router();

  router.post('/setup', async (req, res) => {
    const { email, password, anthropicApiKey, llmProvider, providerApiKey } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'missing_credentials', message: 'Email and password are both required.' });
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'invalid_types', message: 'Email and password must be strings.' });
    }
    // Password policy: ≥10 chars, ≥1 letter, ≥1 digit, no whitespace-only.
    // Cheap and effective; defends against the worst auto-fill garbage.
    if (password.length < 10) return res.status(400).json({ error: 'password_too_short', message: 'Password must be at least 10 characters.' });
    if (password.length > 200) return res.status(400).json({ error: 'password_too_long', message: 'Password is too long.' });
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return res.status(400).json({ error: 'password_weak', message: 'Password must include at least one letter and one digit.' });
    }
    // Light email shape check — proper validation lives at the email provider.
    const normalisedEmail = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalisedEmail)) {
      return res.status(400).json({ error: 'invalid_email', message: 'Email address looks malformed.' });
    }
    if (normalisedEmail.endsWith(ANON_DOMAIN)) return res.status(400).json({ error: 'reserved_domain', message: 'That email domain is reserved.' });
    const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(normalisedEmail);
    if (existing) return res.status(409).json({ error: 'user_exists', message: 'An account already exists for that email.' });
    // Accept either { llmProvider, providerApiKey } (new) or { anthropicApiKey }
    // (legacy single-provider). Default to anthropic if neither field is set.
    const provider = isValidProvider(llmProvider) ? llmProvider : 'anthropic';
    const rawKey = providerApiKey || anthropicApiKey || null;
    const hash = await bcrypt.hash(password, 10);
    const id = randomUUID();
    db.prepare(`INSERT INTO users (id, email, passwordHash, anthropicApiKey, llmProvider, isAnonymous, createdAt) VALUES (?, ?, ?, ?, ?, 0, ?)`)
      .run(id, normalisedEmail, hash, rawKey ? encryptSecret(rawKey) : null, provider, new Date().toISOString());
    res.status(201).json({ id, email: normalisedEmail, llmProvider: provider });
  });

  router.post('/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    const normalisedEmail = String(email).toLowerCase().trim();
    const row = db.prepare(`SELECT * FROM users WHERE email = ? AND isAnonymous = 0`).get(normalisedEmail);
    if (!row) return res.status(401).json({ error: 'invalid credentials' });
    const ok = await bcrypt.compare(password, row.passwordHash);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });
    // Drop any pre-existing anonymous session cookie — promote to authenticated.
    const sessionId = randomUUID();
    const now = Date.now();
    db.prepare(`INSERT INTO sessions (id, userId, createdAt, expiresAt) VALUES (?, ?, ?, ?)`)
      .run(sessionId, row.id, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString());
    res.cookie('lp_session', sessionId, cookieOpts());
    res.json({ sessionId, user: { id: row.id, email: row.email, isAnonymous: false, llmProvider: row.llmProvider || 'anthropic' } });
  });

  router.post('/logout', (req, res) => {
    const sid = req.cookies?.lp_session;
    if (sid) db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sid);
    res.clearCookie('lp_session', { path: '/' });
    res.status(204).end();
  });

  router.get('/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        isAnonymous: !!req.user.isAnonymous,
        llmProvider: req.user.llmProvider || 'anthropic',
        hasApiKey: !!req.user.anthropicApiKey,
        supportedProviders: SUPPORTED_PROVIDERS
      }
    });
  });

  // Save the user's LLM provider + key. New body shape:
  //   { llmProvider: 'anthropic'|'openai'|'deepseek', providerApiKey: string|null }
  // Legacy shape { anthropicApiKey } also accepted — implies provider=anthropic.
  // The key is verified against the provider with a tiny test call BEFORE
  // persisting, so an invalid key never gets stored.
  router.put('/me/api-key', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    const body = req.body || {};
    // Resolve provider + key from either new or legacy body shape.
    const provider = isValidProvider(body.llmProvider) ? body.llmProvider :
      (body.anthropicApiKey !== undefined ? 'anthropic' : (req.user.llmProvider || 'anthropic'));
    const rawKey = body.providerApiKey !== undefined ? body.providerApiKey : body.anthropicApiKey;
    // Clearing the key (null) is allowed — disables LLM access for the user.
    if (rawKey === null || rawKey === '' || rawKey === undefined) {
      db.prepare(`UPDATE users SET anthropicApiKey = NULL, llmProvider = ? WHERE id = ?`)
        .run(provider, req.user.id);
      return res.json({ ok: true, llmProvider: provider, hasApiKey: false });
    }
    if (typeof rawKey !== 'string') {
      return res.status(400).json({ error: 'apiKey must be a string or null' });
    }
    // Cheap prefix check before burning a real API call.
    const expectedPrefix = PROVIDER_KEY_PREFIXES[provider];
    if (expectedPrefix && !rawKey.startsWith(expectedPrefix)) {
      return res.status(400).json({
        error: 'invalid_key_format',
        message: `${provider} keys typically start with "${expectedPrefix}"`
      });
    }
    // Verify with the provider — one-token test call. Catches expired /
    // revoked / mistyped keys before they get persisted.
    const check = await validateProviderKey(provider, rawKey);
    if (!check.ok) {
      return res.status(400).json({
        error: 'key_validation_failed',
        provider,
        details: check.error
      });
    }
    db.prepare(`UPDATE users SET anthropicApiKey = ?, llmProvider = ? WHERE id = ?`)
      .run(encryptSecret(rawKey), provider, req.user.id);
    res.json({ ok: true, llmProvider: provider, hasApiKey: true, modelTested: check.model });
  });

  return router;
}

export function authMiddleware(db) {
  return (req, res, next) => {
    const sid = req.cookies?.lp_session;
    if (!sid) return next();
    const row = db.prepare(
      `SELECT u.id, u.email, u.anthropicApiKey, u.isAnonymous, u.llmProvider
       FROM sessions s JOIN users u ON u.id = s.userId
       WHERE s.id = ? AND s.expiresAt > ?`
    ).get(sid, new Date().toISOString());
    if (row) {
      // Decrypt the stored key transparently — downstream handlers read
      // req.user.anthropicApiKey as plaintext (column name preserved for
      // back-compat; now holds whichever provider's key the user configured).
      if (row.anthropicApiKey) row.anthropicApiKey = decryptSecret(row.anthropicApiKey);
      // Convenience alias — downstream code is migrating to this name.
      row.providerApiKey = row.anthropicApiKey;
      row.llmProvider = row.llmProvider || 'anthropic';
      req.user = row;
    }
    next();
  };
}

// Per-IP rate limit for anonymous-session creation. If a client has cookies
// disabled (corporate browsers commonly do), every request creates a fresh
// anonymous user + workspace and the DB grows without bound. This bucket
// caps the damage — after the limit, we return 503 with a clear message
// instead of silently spawning yet another user row.
const ANON_LIMIT = { windowMs: 60 * 1000, max: 8 };
const _anonHits = new Map(); // ip -> [timestamps]
function anonRateAllow(ip) {
  const now = Date.now();
  const arr = (_anonHits.get(ip) || []).filter(t => now - t < ANON_LIMIT.windowMs);
  if (arr.length >= ANON_LIMIT.max) { _anonHits.set(ip, arr); return false; }
  arr.push(now);
  _anonHits.set(ip, arr);
  return true;
}

export function ensureAnonymousSession(db) {
  return (req, res, next) => {
    if (req.user) return next();
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    if (!anonRateAllow(ip)) {
      return res.status(503).json({
        error: 'cookies_blocked',
        message: "We couldn't set a session cookie — your browser may be blocking cookies for this site. Enable cookies for LegalPulse and reload."
      });
    }
    const userId = randomUUID();
    const sessionId = randomUUID();
    const now = Date.now();
    const email = `anon-${userId.slice(0, 12)}${ANON_DOMAIN}`;
    db.prepare(`INSERT INTO users (id, email, passwordHash, anthropicApiKey, llmProvider, isAnonymous, createdAt) VALUES (?, ?, ?, ?, ?, 1, ?)`)
      .run(userId, email, '!', null, 'anthropic', new Date(now).toISOString());
    db.prepare(`INSERT INTO sessions (id, userId, createdAt, expiresAt) VALUES (?, ?, ?, ?)`)
      .run(sessionId, userId, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString());
    res.cookie('lp_session', sessionId, cookieOpts());
    req.user = { id: userId, email, anthropicApiKey: null, providerApiKey: null, llmProvider: 'anthropic', isAnonymous: 1 };
    next();
  };
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'authentication required' });
  next();
}
