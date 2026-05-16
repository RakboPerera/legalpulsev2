import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveDbPath() {
  // Order of precedence:
  //   1. LEGALPULSE_DB_PATH — explicit override (operators / tests).
  //   2. LEGALPULSE_DATA_DIR — Render disk mount root (production). The
  //      file lives inside the mount so it survives restarts.
  //   3. Production fallback — a relative `backend/storage/legalpulse.db`.
  //      The container's working dir is ephemeral on the free plan, so this
  //      will wipe on every deploy/spin-down. Set LEGALPULSE_DATA_DIR (via
  //      the `disk` block in render.yaml) to make state persistent.
  //   4. Local dev — under %LOCALAPPDATA% so OneDrive sync stays out of it.
  if (process.env.LEGALPULSE_DB_PATH) return process.env.LEGALPULSE_DB_PATH;
  if (process.env.LEGALPULSE_DATA_DIR) {
    return path.join(process.env.LEGALPULSE_DATA_DIR, 'legalpulse.db');
  }
  if (process.env.NODE_ENV === 'production') {
    console.warn('[db] LEGALPULSE_DATA_DIR not set in production — DB will not persist across restarts.');
    return path.join(__dirname, 'storage', 'legalpulse.db');
  }
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(local, 'LegalPulse', 'legalpulse.db');
}

class DatabaseWrapper {
  constructor(db, dbPath) {
    this.db = db;
    this.dbPath = dbPath;
    this._saveScheduled = false;
  }

  prepare(sql) {
    const isInsert = /^\s*insert\b/i.test(sql);
    return {
      run: (...params) => {
        const stmt = this.db.prepare(sql);
        try {
          stmt.bind(this._flat(params));
          stmt.step();
        } finally {
          stmt.free();
        }
        let lastInsertRowid = null;
        // Only fetch last_insert_rowid() for INSERT statements; for
        // UPDATE/DELETE it would return a stale value from a prior insert.
        if (isInsert) {
          const idStmt = this.db.prepare('SELECT last_insert_rowid() AS id');
          try {
            idStmt.step();
            lastInsertRowid = idStmt.getAsObject().id;
          } finally {
            idStmt.free();
          }
        }
        this._scheduleSave();
        return { lastInsertRowid, changes: this.db.getRowsModified() };
      },
      get: (...params) => {
        const stmt = this.db.prepare(sql);
        try {
          stmt.bind(this._flat(params));
          if (stmt.step()) return stmt.getAsObject();
          return undefined;
        } finally {
          stmt.free();
        }
      },
      all: (...params) => {
        const stmt = this.db.prepare(sql);
        const rows = [];
        try {
          stmt.bind(this._flat(params));
          while (stmt.step()) rows.push(stmt.getAsObject());
        } finally {
          stmt.free();
        }
        return rows;
      }
    };
  }

  exec(sql) {
    this.db.exec(sql);
    this._scheduleSave();
  }

  _flat(params) {
    if (params.length === 1 && Array.isArray(params[0])) return params[0];
    return params;
  }

  _scheduleSave() {
    if (this._saveScheduled) return;
    this._saveScheduled = true;
    setImmediate(() => {
      try { this.save(); }
      finally { this._saveScheduled = false; }
    });
  }

  save() {
    try {
      const data = this.db.export();
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
      // Atomic write: write to a tmp file then rename. A crash mid-write
      // leaves the tmp file behind but the real DB is never half-written.
      const tmpPath = `${this.dbPath}.tmp`;
      fs.writeFileSync(tmpPath, Buffer.from(data));
      fs.renameSync(tmpPath, this.dbPath);
    } catch (err) {
      console.error('[db] save failed:', err.message);
      this._saveScheduled = false;
    }
  }
}

let dbInstance = null;

export async function getDb() {
  if (dbInstance) return dbInstance;

  const SQL = await initSqlJs();
  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  let db;
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  dbInstance = new DatabaseWrapper(db, dbPath);
  await initSchema(dbInstance);
  return dbInstance;
}

async function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      anthropicApiKey TEXT,
      isAnonymous INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      expiresAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      name TEXT NOT NULL,
      mode TEXT NOT NULL,
      data TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_entries (
      id TEXT PRIMARY KEY,
      workspaceId TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      type TEXT NOT NULL,
      actor TEXT NOT NULL,
      inputs TEXT,
      outputs TEXT,
      sourceReferences TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audit_workspace ON audit_entries(workspaceId, timestamp);
    CREATE INDEX IF NOT EXISTS idx_workspace_user ON workspaces(userId);
  `);

  // Lightweight schema migrations — applied in order. Each one is idempotent
  // (checks for the column first) so it's safe to run on already-migrated
  // databases. Order matters: don't reorder, and never delete a migration.
  const userCols = db.prepare(`PRAGMA table_info(users)`).all();
  const hasCol = name => userCols.some(c => c.name === name);
  if (!hasCol('isAnonymous')) {
    db.exec(`ALTER TABLE users ADD COLUMN isAnonymous INTEGER NOT NULL DEFAULT 0`);
  }
  // Multi-provider BYOK: stores which provider the user chose. Reuse the
  // existing `anthropicApiKey` column to store the (encrypted) key for
  // whichever provider — name kept for back-compat though it now holds
  // OpenAI/DeepSeek keys too. `llmProvider` distinguishes.
  if (!hasCol('llmProvider')) {
    db.exec(`ALTER TABLE users ADD COLUMN llmProvider TEXT NOT NULL DEFAULT 'anthropic'`);
  }

  db.save();
}
