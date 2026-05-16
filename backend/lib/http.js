import fs from 'fs';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_USER_AGENT = process.env.SEC_EDGAR_USER_AGENT || 'LegalPulse Demo (contact@example.com)';

// Per-source rate limit (requests per second).
const SOURCE_LIMITS = {
  gdelt: 5,
  tavily: 10,
  edgar: 8,
  courtlistener: 4,
  companies_house: 5,
  federal_register: 5,
  eur_lex: 3,
  ofac_sdn: 1,
  eu_sanctions: 1,
  uk_ofsi: 1,
  doj: 5,
  ftc: 5,
  uspto: 5,
  lexology: 3,
  jd_supra: 3,
  career_page: 2,
  dg_comp: 5,
  fca: 5,
  govuk: 5,
  default: 3
};

// Per-source promise chain: each call waits for the previous call's slot to
// clear before computing its own. This eliminates the read-then-write race
// where two concurrent callers both observed the same `last` value and burst
// past the configured RPS.
const _rateChain = new Map();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function rateLimit(source) {
  const rps = SOURCE_LIMITS[source] || SOURCE_LIMITS.default;
  const minInterval = Math.ceil(1000 / rps);
  const prev = _rateChain.get(source) || Promise.resolve();
  const next = prev.then(async () => {
    const jitter = 200 + Math.floor(Math.random() * 300);
    await sleep(minInterval + jitter);
  });
  _rateChain.set(source, next);
  return next;
}

function cachePath(source, url) {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 24);
  const dir = path.join(os.tmpdir(), 'legalpulse-cache', source);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${hash}.json`);
}

function readCache(file, ttlMs) {
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  if (Date.now() - stat.mtimeMs > ttlMs) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeCache(file, payload) {
  try { fs.writeFileSync(file, JSON.stringify(payload)); } catch { /* ignore */ }
}

export async function fetchExternal({
  source = 'default',
  url,
  method = 'GET',
  headers = {},
  body = null,
  responseType = 'json', // 'json' | 'text' | 'buffer'
  schema = null,
  maxRetries = 3,
  cacheTtlMs = 0,
  timeoutMs = 30000,
  audit = null
} = {}) {
  const cacheFile = cacheTtlMs > 0 ? cachePath(source, url) : null;
  if (cacheFile) {
    const cached = readCache(cacheFile, cacheTtlMs);
    if (cached) return cached.payload;
  }

  const finalHeaders = {
    'User-Agent': DEFAULT_USER_AGENT,
    'Accept': responseType === 'json' ? 'application/json' : '*/*',
    ...headers
  };

  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await rateLimit(source);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method, headers: finalHeaders, body: body ?? undefined, signal: ctrl.signal
      });
      clearTimeout(t);

      if (res.status === 429 || res.status === 503) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10);
        const backoff = retryAfter > 0 ? retryAfter * 1000 : Math.pow(4, attempt) * 1000;
        await sleep(Math.min(backoff, 30000));
        continue;
      }

      if (!res.ok) {
        if (res.status >= 500 && attempt < maxRetries) {
          await sleep(Math.pow(4, attempt) * 1000);
          continue;
        }
        const err = new Error(`${source} ${res.status}: ${res.statusText}`);
        err.status = res.status;
        throw err;
      }

      let payload;
      if (responseType === 'json') payload = await res.json();
      else if (responseType === 'text') payload = await res.text();
      else payload = Buffer.from(await res.arrayBuffer());

      if (schema && responseType === 'json') {
        const parsed = schema.safeParse(payload);
        if (!parsed.success) {
          console.warn(`[http] ${source} schema mismatch:`, parsed.error.issues.slice(0, 3));
          return null;
        }
        payload = parsed.data;
      }

      if (cacheFile) writeCache(cacheFile, { payload });
      if (audit) audit({ source, url, status: res.status });
      return payload;
    } catch (err) {
      clearTimeout(t);
      lastError = err;
      if (err.name === 'AbortError' || err.status === 404) {
        break;
      }
      if (attempt < maxRetries) {
        await sleep(Math.pow(4, attempt) * 1000);
      }
    }
  }
  console.warn(`[http] ${source} failed after retries: ${lastError ? lastError.message : 'unknown'} (${url})`);
  return null;
}
