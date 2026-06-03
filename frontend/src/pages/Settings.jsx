import React, { useEffect, useState } from 'react';
import { Check, Key, AlertCircle, Loader2, ExternalLink, Trash2, Mail } from 'lucide-react';
import { auth } from '../api.js';
import { useTitle } from '../lib/useTitle.js';

// Display-only metadata about each provider. Backend is the source of truth
// for the supported list — we just attach human-readable labels + key-prefix
// hints + a docs link.
const PROVIDER_META = {
  anthropic: {
    label: 'Anthropic',
    sub: 'Claude Opus / Sonnet / Haiku',
    keyPrefix: 'sk-ant-',
    placeholder: 'sk-ant-...',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    pricing: '~$0.04 per opportunity (Sonnet 4.6)'
  },
  openai: {
    label: 'OpenAI',
    sub: 'GPT-4.1 / GPT-4o / GPT-4o-mini',
    keyPrefix: 'sk-',
    placeholder: 'sk-proj-... or sk-...',
    docsUrl: 'https://platform.openai.com/api-keys',
    pricing: '~$0.03 per opportunity (GPT-4o)'
  },
  deepseek: {
    label: 'DeepSeek',
    sub: 'DeepSeek Reasoner / Chat',
    keyPrefix: 'sk-',
    placeholder: 'sk-...',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    pricing: '~$0.005 per opportunity (cheapest by ~10×)'
  }
};

export default function Settings() {
  useTitle('Settings');
  const [me, setMe] = useState(null);
  const [loadingMe, setLoadingMe] = useState(true);
  const [provider, setProvider] = useState('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null); // { kind: 'ok'|'err', message, modelTested? }

  // Phase 2 — SendGrid email-send config. Mirrors the LLM-key state above.
  const [sendgridKey, setSendgridKey] = useState('');
  const [showSendgridKey, setShowSendgridKey] = useState(false);
  const [fromAddress, setFromAddress] = useState('');
  const [fromName, setFromName] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailStatus, setEmailStatus] = useState(null);

  useEffect(() => {
    auth.me().then(r => {
      setMe(r.user);
      // Pre-select whichever provider the user already configured.
      if (r.user?.llmProvider) setProvider(r.user.llmProvider);
      // Pre-populate the email from-address + from-name fields so the
      // user can see what's currently set. The actual SendGrid key is
      // never returned by /me — only the hasSendgridKey boolean.
      if (r.user?.emailFromAddress) setFromAddress(r.user.emailFromAddress);
      if (r.user?.emailFromName) setFromName(r.user.emailFromName);
    }).catch(() => {
      // Anonymous session error handling — /me returns 401 only when there's
      // no session cookie at all, which the anon-session middleware prevents.
      // Leaving me=null shows the form anyway.
    }).finally(() => setLoadingMe(false));
  }, []);

  const meta = PROVIDER_META[provider];

  const handleSave = async (e) => {
    e?.preventDefault();
    if (!apiKey.trim()) return;
    setSaving(true);
    setStatus(null);
    try {
      const r = await auth.setProviderKey({
        llmProvider: provider,
        providerApiKey: apiKey.trim()
      });
      setStatus({
        kind: 'ok',
        message: `Key verified and saved. Test call returned via ${r.modelTested || 'model'}.`,
        modelTested: r.modelTested
      });
      setMe(prev => ({ ...prev, hasApiKey: true, llmProvider: provider }));
      setApiKey('');  // clear the input — the key is now stored encrypted
    } catch (err) {
      const body = err.response?.data;
      // Surface the backend's error reason — the prefix-check and
      // live-validation errors are both useful diagnostic messages.
      if (body?.error === 'invalid_key_format') {
        setStatus({ kind: 'err', message: body.message });
      } else if (body?.error === 'key_validation_failed') {
        setStatus({
          kind: 'err',
          message: `${meta.label} rejected the key. ${body.details || ''}`.trim()
        });
      } else {
        setStatus({ kind: 'err', message: body?.message || body?.error || err.message });
      }
    } finally {
      setSaving(false);
    }
  };

  // === Phase 2 — SendGrid email-config save/clear handlers ===
  // Same shape as the LLM key handlers above. Save validates the key
  // with SendGrid before persisting; clear removes both key and
  // from-address. The from-address must be a verified sender on the
  // SendGrid account — that's a SendGrid-side setup, surfaced as a 403
  // when an unverified address tries to send.
  const handleEmailSave = async (e) => {
    e?.preventDefault();
    setEmailSaving(true);
    setEmailStatus(null);
    try {
      const payload = {};
      if (sendgridKey.trim()) payload.sendgridApiKey = sendgridKey.trim();
      if (fromAddress.trim()) payload.emailFromAddress = fromAddress.trim();
      if (fromName.trim() || me?.emailFromName) payload.emailFromName = fromName.trim() || null;
      const r = await auth.setEmailConfig(payload);
      setMe(prev => ({
        ...prev,
        hasSendgridKey: r.hasSendgridKey,
        emailFromAddress: r.emailFromAddress,
        emailFromName: r.emailFromName
      }));
      setSendgridKey('');
      setEmailStatus({ kind: 'ok', message: 'Email config saved.' });
    } catch (err) {
      const body = err.response?.data;
      if (body?.error === 'key_validation_failed') {
        setEmailStatus({ kind: 'err', message: `SendGrid rejected the key. ${body.details || ''}`.trim() });
      } else if (body?.error === 'invalid_from_address') {
        setEmailStatus({ kind: 'err', message: body.message });
      } else {
        setEmailStatus({ kind: 'err', message: body?.message || body?.error || err.message });
      }
    } finally {
      setEmailSaving(false);
    }
  };

  const handleEmailClear = async () => {
    setEmailSaving(true);
    setEmailStatus(null);
    try {
      await auth.clearEmailConfig();
      setMe(prev => ({ ...prev, hasSendgridKey: false, emailFromAddress: null, emailFromName: null }));
      setFromAddress('');
      setFromName('');
      setSendgridKey('');
      setEmailStatus({ kind: 'ok', message: 'Email config cleared.' });
    } catch (err) {
      setEmailStatus({ kind: 'err', message: err.response?.data?.message || err.message });
    } finally {
      setEmailSaving(false);
    }
  };

  const [confirmingClear, setConfirmingClear] = useState(false);

  const handleClearRequest = () => setConfirmingClear(true);

  const handleClearConfirmed = async () => {
    setConfirmingClear(false);
    setSaving(true);
    setStatus(null);
    try {
      await auth.clearProviderKey({ llmProvider: provider });
      setMe(prev => ({ ...prev, hasApiKey: false }));
      setStatus({ kind: 'ok', message: 'Key cleared.' });
    } catch (err) {
      setStatus({ kind: 'err', message: err.response?.data?.message || err.response?.data?.error || err.message });
    } finally {
      setSaving(false);
    }
  };

  if (loadingMe) {
    return (
      <div className="settings-page">
        <div className="settings-loading"><Loader2 size={16} className="spin" /> Loading…</div>
      </div>
    );
  }

  // Show whether the user is using THIS provider vs another one.
  const isActiveProvider = me?.llmProvider === provider;
  const hasKeyForActive = isActiveProvider && me?.hasApiKey;

  return (
    <div className="settings-page">
      <h1>Settings</h1>
      <p className="caption">
        Configure the LLM provider LegalPulse uses for chat, briefings, pitches, and engines.
        Your key is encrypted at rest and never shared.
      </p>

      <div className="settings-section">
        <div className="settings-section-head">
          <Key size={16} />
          <h2>LLM Provider &amp; API Key</h2>
        </div>

        <form onSubmit={handleSave} className="settings-form">
          <label className="settings-field">
            <div className="settings-field-label">Provider</div>
            <div className="settings-provider-grid">
              {Object.entries(PROVIDER_META).map(([id, m]) => (
                <button
                  type="button"
                  key={id}
                  className={`settings-provider-card ${provider === id ? 'active' : ''}`}
                  onClick={() => { setProvider(id); setStatus(null); }}
                >
                  <div className="settings-provider-name">{m.label}</div>
                  <div className="settings-provider-sub">{m.sub}</div>
                  <div className="settings-provider-pricing">{m.pricing}</div>
                </button>
              ))}
            </div>
          </label>

          <label className="settings-field">
            <div className="settings-field-label">
              {meta.label} API key
              {hasKeyForActive && <span className="settings-status-chip"><Check size={11} /> Configured</span>}
            </div>
            <div className="settings-key-row">
              <input
                type={showKey ? 'text' : 'password'}
                className="settings-input settings-key-input"
                placeholder={hasKeyForActive ? '••••••••••• (replace by typing a new key)' : meta.placeholder}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="settings-key-toggle"
                onClick={() => setShowKey(s => !s)}
                tabIndex={-1}
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <div className="settings-field-help">
              {meta.label} keys typically start with <code>{meta.keyPrefix}</code>.{' '}
              <a href={meta.docsUrl} target="_blank" rel="noreferrer" className="settings-help-link">
                Get a key <ExternalLink size={11} />
              </a>
            </div>
          </label>

          {status && (
            <div className={`settings-status settings-status-${status.kind}`}>
              {status.kind === 'ok' ? <Check size={14} /> : <AlertCircle size={14} />}
              <span>{status.message}</span>
            </div>
          )}

          <div className="settings-actions">
            <button
              type="submit"
              className="btn btn-accent"
              disabled={saving || !apiKey.trim()}
            >
              {saving ? <><Loader2 size={14} className="spin" /> Verifying…</> : 'Save & verify'}
            </button>
            {hasKeyForActive && (
              <button
                type="button"
                className="btn btn-secondary settings-clear"
                onClick={handleClearRequest}
                disabled={saving}
              >
                <Trash2 size={12} /> Clear key
              </button>
            )}
          </div>
        </form>
      </div>

      {/* === Phase 2 — Pulse Briefing email-send (SendGrid) ===
          Parallel section to the LLM provider above. Two fields:
          SendGrid API key (encrypted) + verified sender address.
          Without both, the Send button on the Pulse Briefing email
          draft modal returns no_email_key_configured / no_email_from_configured. */}
      <div className="settings-section" style={{ marginTop: 24 }}>
        <div className="settings-section-head">
          <Mail size={16} />
          <h2>Pulse Briefing email-send (SendGrid)</h2>
        </div>

        <form onSubmit={handleEmailSave} className="settings-form">
          <label className="settings-field">
            <div className="settings-field-label">
              SendGrid API key
              {me?.hasSendgridKey && <span className="settings-status-chip"><Check size={11} /> Configured</span>}
            </div>
            <div className="settings-key-row">
              <input
                type={showSendgridKey ? 'text' : 'password'}
                className="settings-input settings-key-input"
                placeholder={me?.hasSendgridKey ? '••••••••••• (replace by typing a new key)' : 'SG.…'}
                value={sendgridKey}
                onChange={e => setSendgridKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="settings-key-toggle"
                onClick={() => setShowSendgridKey(s => !s)}
                tabIndex={-1}
              >
                {showSendgridKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <div className="settings-field-help">
              SendGrid keys start with <code>SG.</code>{' '}
              <a href="https://app.sendgrid.com/settings/api_keys" target="_blank" rel="noreferrer" className="settings-help-link">
                Get a key <ExternalLink size={11} />
              </a>
            </div>
          </label>

          <label className="settings-field">
            <div className="settings-field-label">Verified sender address</div>
            <input
              type="email"
              className="settings-input"
              placeholder="bd@firmname.com"
              value={fromAddress}
              onChange={e => setFromAddress(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <div className="settings-field-help">
              Must be verified in SendGrid (single-sender or domain auth). Unverified addresses return 403 on send.
            </div>
          </label>

          <label className="settings-field">
            <div className="settings-field-label">Sender display name <span className="caption">(optional)</span></div>
            <input
              type="text"
              className="settings-input"
              placeholder="Hartwell &amp; Stone — BD Team"
              value={fromName}
              onChange={e => setFromName(e.target.value)}
            />
          </label>

          {emailStatus && (
            <div className={`settings-status settings-status-${emailStatus.kind}`}>
              {emailStatus.kind === 'ok' ? <Check size={14} /> : <AlertCircle size={14} />}
              <span>{emailStatus.message}</span>
            </div>
          )}

          <div className="settings-actions">
            <button
              type="submit"
              className="btn btn-accent"
              disabled={emailSaving || (!sendgridKey.trim() && !fromAddress.trim() && !fromName.trim())}
            >
              {emailSaving ? <><Loader2 size={14} className="spin" /> Verifying…</> : 'Save & verify'}
            </button>
            {(me?.hasSendgridKey || me?.emailFromAddress) && (
              <button
                type="button"
                className="btn btn-secondary settings-clear"
                onClick={handleEmailClear}
                disabled={emailSaving}
              >
                <Trash2 size={12} /> Clear email config
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="settings-section settings-section-info">
        <h3>How it works</h3>
        <ul className="settings-info-list">
          <li>
            <strong>Your key is verified before saving.</strong> The server makes a 1-token test
            call against {meta.label} and rejects the key if it's invalid.
          </li>
          <li>
            <strong>Encrypted at rest.</strong> Keys are stored with AES-256-GCM, never logged.
          </li>
          <li>
            <strong>Switching providers</strong> is free — pick a different card and save a new
            key. The previously stored key is replaced.
          </li>
          <li>
            <strong>Without a key</strong> you can still browse the demo dataset (signals,
            opportunities, briefings), but live chat / engine runs / new briefing generation are
            disabled.
          </li>
        </ul>
      </div>
      {confirmingClear && (
        <div className="modal-overlay" onClick={() => setConfirmingClear(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="clear-key-title" style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h3 id="clear-key-title">Clear your {meta.label} key?</h3>
            </div>
            <div className="modal-body">
              <p>Chat, briefing drafts, and live opportunity scans will be disabled until you save a new key.</p>
              <p className="caption">Existing baked opportunities and signals remain visible.</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmingClear(false)} autoFocus>Cancel</button>
              <button className="btn btn-warn" onClick={handleClearConfirmed}>
                <Trash2 size={12} /> Clear key
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
