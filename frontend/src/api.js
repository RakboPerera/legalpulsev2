import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true
});

// CSRF double-submit cookie. The backend issues a non-HttpOnly `lp_csrf`
// cookie on first request; we read it here and echo it in X-CSRF-Token on
// state-changing requests so the server can verify same-origin.
function readCookie(name) {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

api.interceptors.request.use(config => {
  const method = (config.method || 'get').toLowerCase();
  if (!['get', 'head', 'options'].includes(method)) {
    const token = readCookie('lp_csrf');
    if (token) {
      config.headers = config.headers || {};
      config.headers['X-CSRF-Token'] = token;
    }
  }
  return config;
});

export default api;

export const auth = {
  me: () => api.get('/auth/me').then(r => r.data),
  setup: payload => api.post('/auth/setup', payload).then(r => r.data),
  login: payload => api.post('/auth/login', payload).then(r => r.data),
  logout: () => api.post('/auth/logout'),
  // Legacy single-provider helper — kept for back-compat with Setup.jsx.
  // New callers should use setProviderKey({ llmProvider, providerApiKey }).
  setApiKey: anthropicApiKey => api.put('/auth/me/api-key', { anthropicApiKey }).then(r => r.data),
  // Multi-provider key configuration. Backend validates the key with a
  // one-token test call against the chosen provider BEFORE persisting.
  setProviderKey: ({ llmProvider, providerApiKey }) =>
    api.put('/auth/me/api-key', { llmProvider, providerApiKey }).then(r => r.data),
  // Clear the configured key (sets it to null). Useful for "log out of provider".
  clearProviderKey: ({ llmProvider }) =>
    api.put('/auth/me/api-key', { llmProvider, providerApiKey: null }).then(r => r.data)
};

export const workspaces = {
  list: () => api.get('/workspaces').then(r => r.data.workspaces),
  create: payload => api.post('/workspaces', payload).then(r => r.data.workspace),
  get: id => api.get(`/workspaces/${id}`).then(r => r.data.workspace),
  remove: id => api.delete(`/workspaces/${id}`),
  rename: (id, name) => api.patch(`/workspaces/${id}`, { name }).then(r => r.data.workspace),
  reloadSnapshot: id => api.post(`/workspaces/${id}/reload-snapshot`).then(r => r.data.workspace),
  firmProfile: id => api.get(`/workspaces/${id}/firm-profile`).then(r => r.data),
  clients: id => api.get(`/workspaces/${id}/clients`).then(r => r.data),
  client: (id, cid) => api.get(`/workspaces/${id}/clients/${cid}`).then(r => r.data),
  matters: id => api.get(`/workspaces/${id}/matters`).then(r => r.data.matters),
  signals: (id, params = {}) => api.get(`/workspaces/${id}/signals`, { params }).then(r => r.data),
  signal: (id, sid) => api.get(`/workspaces/${id}/signals/${sid}`).then(r => r.data.signal),
  audit: (id, params = {}) => api.get(`/workspaces/${id}/audit`, { params }).then(r => r.data),
  reasoning: (id, params = {}) => api.get(`/workspaces/${id}/reasoning`, { params }).then(r => r.data),
  externalSources: id => api.get(`/workspaces/${id}/external-sources`).then(r => r.data.config),
  updateExternalSources: (id, payload) => api.put(`/workspaces/${id}/external-sources`, payload).then(r => r.data.config),
  ingestionStatus: id => api.get(`/workspaces/${id}/ingestion/status`).then(r => r.data),
  ingestionRun: id => api.post(`/workspaces/${id}/ingestion/run-now`).then(r => r.data),
  enginesStatus: id => api.get(`/workspaces/${id}/engines/status`).then(r => r.data),
  runEngine: (id, engine) => api.post(`/workspaces/${id}/engines/${engine}/run`).then(r => r.data),
  // User Input Mode: upload one or both of clients.csv / matters.csv. Files
  // are FormData entries with field names "clients" and "matters".
  ingestCsv: (id, formData) => api.post(`/workspaces/${id}/ingest-csv`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }).then(r => r.data)
};

export const opportunities = {
  // The optional `params.runId` switches the read to a historical pipeline
  // run's snapshot — see backend/routes/runs.js#viewForRun. Falls back to
  // live transparently when omitted.
  list: (id, params = {}) => api.get(`/workspaces/${id}/opportunities`, { params }).then(r => r.data),
  get: (id, oid, params = {}) => api.get(`/workspaces/${id}/opportunities/${oid}`, { params }).then(r => r.data),
  update: (id, oid, payload) => api.patch(`/workspaces/${id}/opportunities/${oid}`, payload).then(r => r.data),
  generateBriefing: (id, oid) => api.post(`/workspaces/${id}/opportunities/${oid}/briefing`).then(r => r.data),
  getBriefing: (id, oid) => api.get(`/workspaces/${id}/opportunities/${oid}/briefing`).then(r => r.data),
  draftEmail: (id, oid) => api.post(`/workspaces/${id}/opportunities/${oid}/draft-email`).then(r => r.data),
  conflictsCheck: (id, entityName) => api.post(`/workspaces/${id}/conflicts/check`, { entityName }).then(r => r.data),
  chat: (id, oid, message, history = []) => api.post(`/workspaces/${id}/opportunities/${oid}/chat`, { message, history }).then(r => r.data),
  // === Pitch document generator ===
  pitchExemplars: (id, oid, k = 4) =>
    api.get(`/workspaces/${id}/opportunities/${oid}/pitch/exemplars`, { params: { k } }).then(r => r.data),
  generatePitch: (id, oid, { mode = 'auto' } = {}) =>
    api.post(`/workspaces/${id}/opportunities/${oid}/pitch`, { mode }).then(r => r.data),
  getPitch: (id, oid) =>
    api.get(`/workspaces/${id}/opportunities/${oid}/pitch`).then(r => r.data),
  pitchDocxUrl: (id, oid) =>
    `/api/workspaces/${id}/opportunities/${oid}/pitch.docx`
};

export const chat = {
  history: id => api.get(`/workspaces/${id}/chat`).then(r => r.data.chatHistory),
  send: (id, message) => api.post(`/workspaces/${id}/chat`, { message }).then(r => r.data),
  clear: id => api.delete(`/workspaces/${id}/chat`)
};

// Event Inquiry — workspace-scoped free-form chat that finds opportunities.
// Different from `screening.chat` which is tied to a pre-extracted event
// cluster. The agent runs tavily_search + identify_opportunities and
// returns proposals the partner can save individually.
export const eventInquiry = {
  chat: (id, message, history = []) =>
    api.post(`/workspaces/${id}/event-inquiry/chat`, { message, history }).then(r => r.data),
  saveOpp: (id, proposal, sourceMessage) =>
    api.post(`/workspaces/${id}/event-inquiry/save-opp`, { proposal, sourceMessage }).then(r => r.data)
};

export const screening = {
  // List event clusters with optional region/industry/since filters.
  events: (id, { region = 'all', industry = 'all', since = '7d', limit = 30 } = {}) =>
    api.get(`/workspaces/${id}/screening/events`, { params: { region, industry, since, limit } }).then(r => r.data),
  // Run the screening agent on a chosen event — generates and persists opps.
  generate: (id, eventKey) =>
    api.post(`/workspaces/${id}/screening/events/${encodeURIComponent(eventKey)}/generate`).then(r => r.data),
  // Per-event chat — agent has Tavily search + opportunity-identify tools.
  chat: (id, eventKey, message, history = []) =>
    api.post(`/workspaces/${id}/screening/events/${encodeURIComponent(eventKey)}/chat`, { message, history }).then(r => r.data),
  // Wipe all market_screening opps + their discovered prospects.
  clear: id => api.delete(`/workspaces/${id}/screening/clear`).then(r => r.data)
};

export const kpi = {
  // Firm-wide commercial health snapshot with breakdowns by practice /
  // partner / sector / client. Server-aggregated; one call, ready to render.
  summary: (id, { range = 'all' } = {}) =>
    api.get(`/workspaces/${id}/kpi/summary`, { params: { range } }).then(r => r.data)
};

export const worthiness = {
  // Per-entity worthiness score (3 components for clients, 2 for prospects).
  // Computed on-the-fly server-side from workspace state.
  forEntity: (id, eid) =>
    api.get(`/workspaces/${id}/entities/${eid}/worthiness`).then(r => r.data)
};

export const insights = {
  // Operational exception lists — budget overruns, unprofitable matters,
  // stale matters. Thresholds are tunable per request; the page passes
  // null for the defaults to let the server apply the seeded conservative
  // values.
  operational: (id, { budgetThreshold, marginThreshold, staleDays } = {}) => {
    const params = {};
    if (budgetThreshold != null) params.budgetThreshold = budgetThreshold;
    if (marginThreshold != null) params.marginThreshold = marginThreshold;
    if (staleDays != null)       params.staleDays = staleDays;
    return api.get(`/workspaces/${id}/insights/operational`, { params }).then(r => r.data);
  }
};

export const version = () => api.get('/version').then(r => r.data);

// === Pipeline runner with Server-Sent Events ===
// EventSource is GET-only and can't carry CSRF tokens or custom headers,
// so we use fetch + ReadableStream to consume the SSE response from a POST
// request. Event format is `event: <name>\ndata: <json>\n\n` — same wire
// format an EventSource would parse, just consumed manually.
// Pipeline run history. Reads the workspace's archived runs (capped at 5
// most recent) plus a synthesized "live" entry for whatever's currently
// in the active state.
export const runs = {
  list: id => api.get(`/workspaces/${id}/runs`).then(r => r.data),
  get: (id, runId) => api.get(`/workspaces/${id}/runs/${runId}`).then(r => r.data)
};

export const pipeline = {
  /**
   * Run the full pipeline (ingest → engines → briefings). Streams progress
   * back via callbacks until the server emits `done` or `error`.
   *
   * @param {string} workspaceId
   * @param {object} body — { sources?: string[], engines?: string[],
   *                          generateBriefings?: bool, briefingTopN?: number }
   * @param {object} handlers — { onLog, onProgress, onDone, onError }
   * @returns {{ cancel: () => void }} — call cancel() to abort mid-run
   */
  run(workspaceId, body, handlers = {}) {
    const controller = new AbortController();
    const csrf = readCookieForCsrf();
    const headers = { 'Content-Type': 'application/json' };
    if (csrf) headers['X-CSRF-Token'] = csrf;

    (async () => {
      let response;
      try {
        response = await fetch(`/api/workspaces/${workspaceId}/pipeline/run`, {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify(body || {}),
          signal: controller.signal
        });
      } catch (err) {
        if (err.name !== 'AbortError') handlers.onError?.({ message: err.message });
        return;
      }

      // Backend can short-circuit with a JSON 400 (e.g. no_llm_key_configured)
      // BEFORE the SSE stream opens. Detect that by the content-type and
      // surface it via onError instead of trying to parse the body as SSE.
      const ct = response.headers.get('content-type') || '';
      if (!response.ok && !ct.includes('text/event-stream')) {
        let parsed;
        try { parsed = await response.json(); } catch { parsed = { message: response.statusText }; }
        handlers.onError?.(parsed);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      // SSE events are delimited by blank lines (\n\n). Buffer partial chunks
      // until we have a complete event, then parse out `event:` + `data:`.
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // Split on the SSE record terminator. Last element is the partial
          // record we haven't finished receiving — keep it in the buffer.
          const records = buffer.split('\n\n');
          buffer = records.pop();
          for (const record of records) {
            if (!record.trim()) continue;
            const event = parseSSE(record);
            if (!event) continue;
            dispatchEvent(event, handlers);
          }
        }
        // Flush any trailing record that didn't end with \n\n (rare — most
        // servers emit the trailing blank line, but be defensive).
        if (buffer.trim()) {
          const event = parseSSE(buffer);
          if (event) dispatchEvent(event, handlers);
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          handlers.onError?.({ message: `stream read failed: ${err.message}` });
        }
      }
    })();

    return { cancel: () => controller.abort() };
  }
};

function parseSSE(record) {
  // SSE record format: each non-blank line is a field starting with
  // "<name>: <value>". We only care about `event` and `data`.
  let eventName = 'message';
  const dataLines = [];
  for (const line of record.split('\n')) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  const raw = dataLines.join('\n');
  let data;
  try { data = JSON.parse(raw); } catch { data = { raw }; }
  return { event: eventName, data };
}

function dispatchEvent({ event, data }, handlers) {
  switch (event) {
    case 'log':      handlers.onLog?.(data); break;
    case 'progress': handlers.onProgress?.(data); break;
    case 'error':    handlers.onError?.(data); break;
    case 'done':     handlers.onDone?.(data); break;
    default: /* ignore unknown event types */ break;
  }
}

// Re-read the CSRF cookie at the point of the call (not at module load) —
// the cookie can be set on first request, so a cached value at import time
// would be missing. Duplicates the helper in the axios interceptor block
// above; kept inline so this section is self-contained.
function readCookieForCsrf() {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|; )lp_csrf=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : null;
}
