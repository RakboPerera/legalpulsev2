import crypto from 'crypto';

// Symmetric AES-256-GCM encryption for at-rest secrets (currently:
// per-user anthropicApiKey). The encryption key comes from LEGALPULSE_SECRET_KEY
// — either a 64-char hex string (32 bytes) or a passphrase that we hash to
// 32 bytes. If the env var is unset, the module falls back to identity
// (no encryption) and logs a one-time warning — important so the demo
// keeps booting on first-time setups without breaking auth flows.
//
// Stored format: "enc:v1:" + base64(iv | tag | ciphertext)
// Plaintext values (legacy rows pre-encryption) are detected by the absence
// of the "enc:v1:" prefix and re-encrypted transparently on next write.
const PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';

let _key = null;
let _warned = false;

function getKey() {
  if (_key !== null) return _key;
  const raw = process.env.LEGALPULSE_SECRET_KEY;
  if (!raw) {
    if (!_warned) {
      _warned = true;
      console.warn('[secrets] LEGALPULSE_SECRET_KEY not set — API keys stored in PLAINTEXT. Set this env var in production.');
    }
    _key = false;
    return _key;
  }
  // Accept 64-hex (32 raw bytes) directly, otherwise SHA-256 the passphrase.
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    _key = Buffer.from(raw, 'hex');
  } else {
    _key = crypto.createHash('sha256').update(raw, 'utf8').digest();
  }
  return _key;
}

export function encryptSecret(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return plaintext;
  if (typeof plaintext !== 'string') return plaintext;
  if (plaintext.startsWith(PREFIX)) return plaintext;  // already encrypted
  const key = getKey();
  if (!key) return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptSecret(stored) {
  if (stored === null || stored === undefined || stored === '') return stored;
  if (typeof stored !== 'string') return stored;
  if (!stored.startsWith(PREFIX)) return stored;  // legacy plaintext row
  const key = getKey();
  if (!key) {
    // Encrypted value but no key configured — the data is unrecoverable in
    // this process. Treat as null rather than crashing the request.
    console.warn('[secrets] encrypted value present but LEGALPULSE_SECRET_KEY is unset — returning null');
    return null;
  }
  try {
    const payload = Buffer.from(stored.slice(PREFIX.length), 'base64');
    const iv = payload.subarray(0, 12);
    const tag = payload.subarray(12, 28);
    const ct = payload.subarray(28);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch (err) {
    console.warn('[secrets] decryption failed:', err.message);
    return null;
  }
}
