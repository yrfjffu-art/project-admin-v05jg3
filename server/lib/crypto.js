import crypto from 'node:crypto';
import { config } from './config.js';

const kid = (key) => crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);

/** AES-256-GCM. Output: v1:<kid>:<iv>:<tag>:<ciphertext> (base64url parts). */
export function encrypt(plain) {
  const key = config.encryptionKeys[0];
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', kid(key), iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
}

export function decrypt(blob) {
  const [v, k, iv, tag, ct] = String(blob || '').split(':');
  if (v !== 'v1') throw new Error('Unsupported ciphertext');
  const key = config.encryptionKeys.find((x) => kid(x) === k);
  if (!key) throw new Error('Encryption key not available');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

/**
 * Keyed hash for anything we look up by secret value (API keys, agent tokens, refresh tokens,
 * webhook secrets). Using HMAC with a server-only pepper means a row inserted by someone who
 * can write to the table but doesn't know the pepper can never match a real request.
 */
export function hmacHash(value, purpose) {
  return 'h1:' + crypto.createHmac('sha256', config.hashPepper).update(`${purpose}:${value}`).digest('hex');
}

export function hmacHex(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  if (x.length !== y.length) { crypto.timingSafeEqual(x, x); return false; }
  return crypto.timingSafeEqual(x, y);
}

/** Per-build key that the GitHub Actions run uses to sign its callbacks. */
export function buildCallbackKey(buildId) {
  return hmacHex(config.callbackSecret, `build:${buildId}`);
}
