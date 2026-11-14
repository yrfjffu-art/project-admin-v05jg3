import crypto from 'node:crypto';
import { readSecret, writeSecret } from '../lib/vault.js';
import { config } from '../lib/config.js';

// Admin accounts live in the private vault, never in a table reachable with the anon key.
const keyFor = (email) => `admin/users/${crypto.createHash('sha256').update(email).digest('hex')}.json`;

export async function getAdmin(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  const rec = await readSecret(keyFor(e));
  if (rec) return rec;
  // Bootstrap from env (ADMIN_EMAIL + ADMIN_PASSWORD_HASH) until the first save.
  if (config.adminEmail && e === config.adminEmail && config.adminPasswordHash) {
    return { email: e, password_hash: config.adminPasswordHash, totp_enabled: false, failed_attempts: 0, locked_until: null, created_at: new Date().toISOString() };
  }
  return null;
}

export async function saveAdmin(rec) {
  await writeSecret(keyFor(rec.email), rec);
}
