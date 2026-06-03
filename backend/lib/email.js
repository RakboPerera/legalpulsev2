// SendGrid v3 mail-send adapter. The only delivery surface in the
// product today — a partner clicks "Send" on the Pulse Briefing email
// draft modal, the modal POSTs to the opportunities/send-email route,
// which calls into this lib.
//
// Why SendGrid (not nodemailer + SMTP):
//   - No SMTP credential boilerplate (host, port, TLS, etc.)
//   - Per-user BYOK fits the existing secret-storage pattern
//   - The 202 response is the success contract — easy to surface to UI
//
// Why not built-in fetch retries:
//   - SendGrid returns deterministic 4xx for permanent failures (bad
//     key, unverified sender, invalid recipient) — retrying those
//     wastes calls and budget. Transient 5xx is rare and recoverable
//     by the user clicking Send again.

const SENDGRID_ENDPOINT = 'https://api.sendgrid.com/v3/mail/send';

// Quick prefix check before burning a real SendGrid API call. SendGrid
// keys are documented as starting with "SG." — we don't enforce the
// rest of the format (length varies historically).
export function looksLikeSendGridKey(s) {
  return typeof s === 'string' && /^SG\.[A-Za-z0-9_\-.]{16,}/.test(s);
}

// Validate a candidate key with a tiny SendGrid API call. Hits the
// scopes endpoint (returns the key's allowed actions) — cheap, no
// charges, no email sent. Mirrors the LLM-key validation pattern in
// backend/lib/llm/index.js#validateProviderKey.
export async function validateSendGridKey(apiKey) {
  if (!looksLikeSendGridKey(apiKey)) {
    return { ok: false, error: 'Key does not match the expected "SG.…" format.' };
  }
  try {
    const res = await fetch('https://api.sendgrid.com/v3/scopes', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (res.status === 200) {
      const body = await res.json().catch(() => ({}));
      return { ok: true, scopes: body.scopes || [] };
    }
    const text = await res.text().catch(() => '');
    return { ok: false, error: `SendGrid responded ${res.status}: ${text.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, error: err.message || 'Network error contacting SendGrid' };
  }
}

// Send a single email via SendGrid v3. Returns { ok: true, messageId } on
// success or { ok: false, status, error } on failure. Never throws — the
// route handler reads the boolean and constructs the HTTP response.
//
// Note on `from`: SendGrid REQUIRES the address to be verified in the
// account (single-sender verification or domain authentication). An
// unverified sender returns 403 with a clear message; the route handler
// surfaces that to the UI.
export async function sendEmailViaSendGrid({ to, subject, body, from, fromName, apiKey }) {
  if (!apiKey) return { ok: false, status: 0, error: 'no_api_key' };
  if (!to)     return { ok: false, status: 0, error: 'missing_recipient' };
  if (!from)   return { ok: false, status: 0, error: 'missing_sender' };

  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from: fromName ? { email: from, name: fromName } : { email: from },
    subject: subject || '(no subject)',
    content: [{ type: 'text/plain', value: body || '' }]
  };

  let res;
  try {
    res = await fetch(SENDGRID_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    return { ok: false, status: 0, error: err.message || 'network_error' };
  }

  // SendGrid returns 202 Accepted on success (the email is queued, not
  // necessarily delivered yet — full delivery telemetry is via webhooks).
  // x-message-id is the queue ID, useful for downstream audit-trail rows.
  if (res.status === 202) {
    return { ok: true, status: 202, messageId: res.headers.get('x-message-id') };
  }

  let errBody;
  try { errBody = await res.text(); } catch { errBody = ''; }
  return { ok: false, status: res.status, error: errBody.slice(0, 400) };
}
