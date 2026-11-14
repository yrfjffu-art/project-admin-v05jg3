import crypto from 'node:crypto';

// All server secrets. Each one can be set explicitly; if unset it is derived (HKDF)
// from SUPABASE_SERVICE_ROLE_KEY so the app works out of the box. Set them explicitly
// in production and never change them afterwards (stored hashes/ciphertexts depend on them).
const cache = new Map();

function master() {
  const m = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!m) throw new Error('Server misconfigured: SUPABASE_SERVICE_ROLE_KEY is not set');
  return m;
}

function derived(label) {
  return Buffer.from(crypto.hkdfSync('sha256', master(), 'web2apk-v1', label, 32));
}

function secret(envName, label) {
  if (cache.has(envName)) return cache.get(envName);
  const v = process.env[envName];
  const key = v ? crypto.createHash('sha256').update(v).digest() : derived(label);
  cache.set(envName, key);
  return key;
}

function parseList(v) {
  return String(v || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
}

export const config = {
  get encryptionKeys() {
    // First key encrypts; all keys are tried when decrypting (lets you move from derived -> explicit).
    const keys = [secret('APP_ENCRYPTION_KEY', 'encryption')];
    if (process.env.APP_ENCRYPTION_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY) keys.push(derived('encryption'));
    return keys;
  },
  get hashPepper() { return secret('HASH_PEPPER', 'pepper'); },
  get callbackSecret() { return secret('CALLBACK_SECRET', 'callback'); },
  get adminJwtSecret() { return secret('ADMIN_JWT_SECRET', 'admin-jwt'); },

  get adminPath() {
    const p = String(process.env.ADMIN_PATH || '').replace(/^\/+|\/+$/g, '');
    // Must be long, unguessable and URL-safe; anything else disables the admin panel entirely.
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(p) || /^admin/i.test(p)) return null;
    return p;
  },
  get adminEmail() { return String(process.env.ADMIN_EMAIL || '').trim().toLowerCase() || null; },
  get adminPasswordHash() { return process.env.ADMIN_PASSWORD_HASH || null; },

  get corsOrigins() { return parseList(process.env.CORS_ORIGINS); },
  get apiCorsOrigins() { return parseList(process.env.API_CORS_ORIGINS); },
  get publicBaseUrl() { return String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '') || null; },
  get isProd() { return process.env.NODE_ENV === 'production' || !!process.env.VERCEL; },
};

/** Public origin of this deployment (used for webhook/callback URLs). */
export function baseUrl(req) {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${proto}://${host}`;
}
