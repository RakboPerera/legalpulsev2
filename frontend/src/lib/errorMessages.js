// Map backend error codes to partner-readable messages.
//
// Backend routes typically respond with {error: 'code', message: 'sentence'}.
// The UI used to show the raw code (e.g. "no_llm_key_configured") because
// callers did `err.response?.data?.error || err.message`. This module gives
// every surface the same friendly text, and a single place to extend.

const FRIENDLY = {
  no_llm_key_configured: 'Add your AI provider key in Settings to use this feature.',
  invalid_api_key:       'Your AI provider key was rejected. Open Settings and re-enter it.',
  api_key_expired:       'Your AI provider key has expired. Open Settings and re-enter it.',
  rate_limited:          'Your AI provider returned a rate-limit. Wait a few seconds and try again.',
  rate_limit:            'Your AI provider returned a rate-limit. Wait a few seconds and try again.',
  provider_unavailable:  'The AI provider is temporarily unreachable. Try again in a moment.',
  provider_error:        'The AI provider returned an error. Try again, or switch provider in Settings.',
  unauthorized:          'Please sign in to continue.',
  forbidden:             "You don't have permission for this action.",
  not_found:             'Not found.',
  conflict:              'That action conflicts with the current state — refresh the page and retry.',
  upload_failed:         'Upload failed. Try again, or check the file size.',
  file_too_large:        'That file is too large.',
  no_files:              'No file selected.',
  wrong_mode:            'This action isn’t available in this workspace mode.',
  csrf_mismatch:         'Your session expired. Refresh the page and try again.',
  bad_request:           'The request was malformed.',
  internal_error:        'Something went wrong on our side. Try again in a moment.'
};

/**
 * Resolve an Axios / fetch error (or a {data, status}) to a single sentence
 * the user can act on. Always prefers the server-provided `message` if there
 * is one, falls back to mapped friendly text, and finally to a generic line.
 * Never returns a snake_case identifier.
 */
export function friendlyError(err) {
  if (!err) return 'Something went wrong.';
  const data = err.response?.data || err.data || {};
  if (typeof data.message === 'string' && data.message.trim()) return data.message.trim();
  const code = (typeof data.error === 'string' && data.error) || (typeof err.code === 'string' && err.code);
  if (code && FRIENDLY[code]) return FRIENDLY[code];
  const status = err.response?.status || err.status;
  if (status === 401) return FRIENDLY.unauthorized;
  if (status === 403) return FRIENDLY.forbidden;
  if (status === 404) return FRIENDLY.not_found;
  if (status === 409) return FRIENDLY.conflict;
  if (status === 413) return FRIENDLY.file_too_large;
  if (status === 429) return FRIENDLY.rate_limited;
  if (status >= 500) return FRIENDLY.internal_error;
  if (err.message && !/^[a-z_]+$/.test(err.message)) return err.message;
  return 'Something went wrong. Try again.';
}

/**
 * True when the error means "the user needs to set up / refresh their AI key".
 * Lets callers route the user to Settings with a single click.
 */
export function isKeyError(err) {
  const code = err?.response?.data?.error;
  return code === 'no_llm_key_configured' || code === 'invalid_api_key' || code === 'api_key_expired';
}
