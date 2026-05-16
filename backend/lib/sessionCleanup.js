// Periodic cleanup of expired sessions and the anonymous-user rows that have
// no remaining active session. Anonymous users are created cheaply on every
// unauthenticated visit (see auth.js#ensureAnonymousSession) — without this,
// the users table grows unboundedly. Authenticated users are NEVER deleted,
// only their expired session rows.
const HOUR_MS = 60 * 60 * 1000;

export function startSessionCleanup(db, { intervalMs = 6 * HOUR_MS } = {}) {
  const run = () => {
    try {
      const now = new Date().toISOString();
      const expired = db.prepare(
        `DELETE FROM sessions WHERE expiresAt <= ?`
      ).run(now);
      // Delete anonymous users that no longer have ANY session pointing at
      // them. Their workspaces are deleted too — anonymous workspaces have
      // no value once the session cookie is gone (the user can never get
      // back to them anyway).
      const orphans = db.prepare(`
        SELECT u.id FROM users u
        LEFT JOIN sessions s ON s.userId = u.id
        WHERE u.isAnonymous = 1 AND s.id IS NULL
      `).all();
      if (orphans.length) {
        const delWs = db.prepare(`DELETE FROM workspaces WHERE userId = ?`);
        const delUser = db.prepare(`DELETE FROM users WHERE id = ?`);
        for (const o of orphans) {
          delWs.run(o.id);
          delUser.run(o.id);
        }
      }
      if (expired.changes || orphans.length) {
        console.log(`[session-cleanup] expired=${expired.changes} anon-users=${orphans.length}`);
      }
    } catch (err) {
      console.warn('[session-cleanup] failed:', err.message);
    }
  };

  // Run once on boot then on interval. Use unref so the timer doesn't keep
  // the process alive on shutdown.
  run();
  const handle = setInterval(run, intervalMs);
  if (typeof handle.unref === 'function') handle.unref();
  return handle;
}
