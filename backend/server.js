import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { getDb } from './database.js';
import { createAuthRouter, authMiddleware, ensureAnonymousSession } from './routes/auth.js';
import { createWorkspacesRouter } from './routes/workspaces.js';
import { createOpportunitiesRouter } from './routes/opportunities.js';
import { createEnginesRouter } from './routes/engines.js';
import { createChatRouter } from './routes/chat.js';
import { createIngestionRouter } from './routes/ingestion.js';
import { createScreeningRouter } from './routes/screening.js';
import { createKpiRouter } from './routes/kpi.js';
import { createInsightsRouter } from './routes/insights.js';
import { createWorthinessRouter } from './routes/worthiness.js';
import { createReasoningRouter } from './routes/reasoning.js';
import { createPipelineRouter } from './routes/pipeline.js';
import { createRunsRouter } from './routes/runs.js';
import { createEventInquiryRouter } from './routes/eventInquiry.js';
import { createWorkspace, listWorkspaces } from './lib/workspaceStore.js';
import { startSessionCleanup } from './lib/sessionCleanup.js';
import { csrfMiddleware } from './lib/csrf.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 8000;

function buildCorsConfig() {
  // Production: same-origin only (server serves frontend + API). Browsers
  // still attach an Origin header to module-script and stylesheet loads, so
  // the deployed URL must be allowed explicitly or every asset request 500s.
  // Development: allow any localhost / 127.0.0.1 port — Vite picks the next
  // available port when 5173 is taken (5174, 5175, 5176, …) so a fixed list
  // breaks across rebuilds.
  const isProd = process.env.NODE_ENV === 'production';
  const explicit = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const localhostRegex = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  // RENDER_EXTERNAL_URL is auto-injected by Render with the service's public URL
  // (e.g. https://legalpulsev2.onrender.com). Allow it implicitly so deploys
  // don't require a separate env-var step.
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  // In dev we tolerate any *.onrender.com preview origin. In production we
  // require explicit allow-list (CORS_ALLOWED_ORIGINS) or RENDER_EXTERNAL_URL
  // exact match — any onrender.com origin would otherwise let a malicious
  // sibling deployment ride a user's session cookie.
  const renderHostRegex = /^https?:\/\/[a-z0-9-]+\.onrender\.com$/i;
  return {
    origin(origin, cb) {
      if (!origin) return cb(null, true); // same-origin / curl
      if (explicit.includes(origin)) return cb(null, true);
      if (!isProd && localhostRegex.test(origin)) return cb(null, true);
      if (renderUrl && origin === renderUrl) return cb(null, true);
      if (!isProd && renderHostRegex.test(origin)) return cb(null, true);
      return cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true
  };
}

async function main() {
  const db = await getDb();
  startSessionCleanup(db);

  const app = express();
  app.disable('x-powered-by');

  // Request log — runs BEFORE everything else so we can see whether requests
  // reach Express at all (vs being blocked at Render's edge / Cloudflare).
  app.use((req, res, next) => {
    console.log(`[req] ${req.method} ${req.path}`);
    next();
  });

  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(cors(buildCorsConfig()));

  // CSRF: double-submit cookie pattern. Must run AFTER cookieParser (needs
  // req.cookies) and BEFORE any state-changing route handler. Skips safe
  // methods and the unauth login endpoints internally.
  app.use('/api', csrfMiddleware());

  // Attach req.user from session cookie when present. Does NOT auto-create a session.
  app.use(authMiddleware(db));

  // Health / version routes never require a session.
  app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.get('/api/version', (req, res) => {
    const bakePath = path.join(__dirname, '..', 'data', 'bake-summary.json');
    let bake = null;
    if (fs.existsSync(bakePath)) {
      try { bake = JSON.parse(fs.readFileSync(bakePath, 'utf8')); } catch { /* noop */ }
    }
    res.json({ version: '0.2.0', name: 'LegalPulse', bake });
  });

  // Auth router doesn't need anonymous session.
  app.use('/api/auth', createAuthRouter(db));

  // Workspace-scoped APIs ensure an anonymous session exists so an unauthenticated
  // visitor still gets their own private demo workspace (no shared state).
  app.use('/api/workspaces', ensureAnonymousSession(db), ensureDemoWorkspaceForUser(db));

  app.use('/api/workspaces', createWorkspacesRouter(db));
  app.use('/api/workspaces', createOpportunitiesRouter(db));
  app.use('/api/workspaces', createEnginesRouter(db));
  app.use('/api/workspaces', createChatRouter(db));
  app.use('/api/workspaces', createIngestionRouter(db));
  app.use('/api/workspaces', createScreeningRouter(db));
  app.use('/api/workspaces', createKpiRouter(db));
  app.use('/api/workspaces', createInsightsRouter(db));
  app.use('/api/workspaces', createWorthinessRouter(db));
  app.use('/api/workspaces', createReasoningRouter(db));
  app.use('/api/workspaces', createPipelineRouter(db));
  app.use('/api/workspaces', createRunsRouter(db));
  app.use('/api/workspaces', createEventInquiryRouter(db));

  // Serve frontend build in production.
  const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
  const distExists = fs.existsSync(frontendDist);
  const indexExists = distExists && fs.existsSync(path.join(frontendDist, 'index.html'));
  console.log(`[server] frontendDist path: ${frontendDist}`);
  console.log(`[server] dist exists: ${distExists} · index.html exists: ${indexExists}`);
  if (distExists) {
    try {
      console.log(`[server] dist contents: ${fs.readdirSync(frontendDist).join(', ')}`);
      const assetsDir = path.join(frontendDist, 'assets');
      if (fs.existsSync(assetsDir)) {
        const items = fs.readdirSync(assetsDir).map(name => {
          try {
            const s = fs.statSync(path.join(assetsDir, name));
            return `${name} (${s.size}B)`;
          } catch { return name; }
        });
        console.log(`[server] dist/assets contents: ${items.join(', ')}`);
      } else {
        console.log(`[server] dist/assets MISSING`);
      }
    } catch (e) { console.log(`[server] could not list dist:`, e.message); }
  }
  if (indexExists) {
    // Mount /assets explicitly. Default serve-static MIME detection handles
    // .js / .css correctly — kept simple to rule out option-related bugs.
    app.use('/assets', express.static(path.join(frontendDist, 'assets')));

    // Top-level static files in dist (favicon, logo, etc.).
    app.use(express.static(frontendDist));

    // SPA fallback: only for HTML route paths. /api/* is a missing-API 404,
    // any path with a file extension is a missing-asset 404 (NOT HTML).
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      if (path.extname(req.path)) return next();
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  } else {
    app.get('/', (req, res) => res.json({
      name: 'LegalPulse API',
      frontend: 'not built',
      checked: frontendDist,
      cwd: process.cwd()
    }));
  }

  // Centralised error handler — surfaces what's actually throwing 500s so we
  // can read it in Render's runtime log instead of guessing from the browser.
  app.use((err, req, res, next) => {
    console.error(`[server] ERROR on ${req.method} ${req.path}:`, err && err.stack ? err.stack : err);
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  });

  app.listen(PORT, () => {
    console.log(`[server] LegalPulse API listening on http://localhost:${PORT}`);
  });
}

// Ensure each authenticated (or anonymous) user has at least one demo workspace,
// so they land on a populated dashboard rather than an empty workspaces list.
function ensureDemoWorkspaceForUser(db) {
  return (req, res, next) => {
    try {
      if (!req.user) return next();
      const existing = listWorkspaces(db, req.user.id);
      if (existing.length === 0) {
        createWorkspace(db, req.user.id, { mode: 'demo', name: 'Hartwell & Stone (demo)' });
      }
    } catch (err) {
      console.warn('[server] ensureDemoWorkspaceForUser:', err.message);
    }
    next();
  };
}

main().catch(err => {
  console.error('[server] fatal:', err);
  process.exit(1);
});
