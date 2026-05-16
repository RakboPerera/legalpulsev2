import crypto from 'crypto';

// Double-submit cookie CSRF protection.
//   1. Server sets a non-HttpOnly `lp_csrf` cookie containing a random token.
//   2. Client JS reads the cookie and echoes it in the `X-CSRF-Token` header
//      on state-changing requests (POST/PUT/PATCH/DELETE).
//   3. The server middleware checks header === cookie. An attacker on a
//      different origin can't read the cookie (same-origin policy on JS
//      access), so they can't forge the header.
//
// Trade-off vs synchronizer tokens: simpler, stateless, but relies on the
// browser's same-origin policy for cookie reads. SameSite=lax already
// prevents most CSRF; this is defense-in-depth.
const COOKIE_NAME = 'lp_csrf';
const HEADER_NAME = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

export function csrfMiddleware() {
  return (req, res, next) => {
    // Always ensure the cookie exists so the next state-changing request can
    // succeed without a separate /csrf round-trip. Non-HttpOnly on purpose —
    // the frontend needs to read it.
    if (!req.cookies?.[COOKIE_NAME]) {
      const token = newToken();
      res.cookie(COOKIE_NAME, token, {
        httpOnly: false,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/'
      });
      req.cookies = req.cookies || {};
      req.cookies[COOKIE_NAME] = token;
    }
    // Skip CSRF check on safe methods and on the auth login endpoints —
    // login itself can't be CSRF'd to do harm (it requires valid creds),
    // and a fresh visitor won't have a CSRF cookie yet.
    if (SAFE_METHODS.has(req.method)) return next();
    if (req.path === '/auth/login' || req.path === '/auth/setup' || req.path === '/auth/logout') return next();
    const cookieToken = req.cookies[COOKIE_NAME];
    const headerToken = req.get(HEADER_NAME);
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      return res.status(403).json({ error: 'csrf_invalid', message: 'CSRF token missing or invalid.' });
    }
    next();
  };
}
