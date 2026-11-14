import fs from 'node:fs/promises';
import path from 'node:path';
import supabase from '../../api/db-client.js';
import { hmacHash } from './crypto.js';

// Secrets live in the PRIVATE 'secrets' storage bucket (service-role only), never in tables.
// VAULT_DIR (optional) switches to a local directory - for local development/tests only.
const DIR = process.env.VAULT_DIR;
const safeKey = (key) => {
  if (!/^[\w./-]+$/.test(key) || key.includes('..')) throw new Error('Invalid vault key');
  return key;
};

export async function readSecret(key) {
  safeKey(key);
  if (DIR) {
    try { return JSON.parse(await fs.readFile(path.join(DIR, key), 'utf8')); } catch { return null; }
  }
  const { data, error } = await supabase.storage.from('secrets').download(key);
  if (error || !data) return null;
  try { return JSON.parse(await data.text()); } catch { return null; }
}

export async function writeSecret(key, value) {
  safeKey(key);
  if (DIR) {
    await fs.mkdir(path.dirname(path.join(DIR, key)), { recursive: true });
    return fs.writeFile(path.join(DIR, key), JSON.stringify(value), { mode: 0o600 });
  }
  const { error } = await supabase.storage.from('secrets').upload(key, Buffer.from(JSON.stringify(value)), { contentType: 'application/json', upsert: true });
  if (error) throw error;
}

export async function deleteSecret(key) {
  safeKey(key);
  if (DIR) return fs.rm(path.join(DIR, key), { force: true });
  await supabase.storage.from('secrets').remove([key]);
}

/** Agent tokens are stored as a peppered HMAC (see crypto.hmacHash). */
export const hashToken = (t) => hmacHash(t, 'agent-token');
