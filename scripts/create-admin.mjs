#!/usr/bin/env node
// Create or reset an admin account directly in the private vault (needs server env:
// NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
//   npm run admin:create -- --email you@example.com          (password read from stdin)
//   npm run admin:create -- --email you@example.com --reset-2fa
import bcrypt from 'bcryptjs';
import readline from 'node:readline';
import { getAdmin, saveAdmin } from '../server/admin/store.js';
import { strongPasswordError } from '../server/admin/router.js';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };
const email = String(arg('email') || '').trim().toLowerCase();
if (!/^\S+@\S+\.\S+$/.test(email)) { console.error('Usage: npm run admin:create -- --email you@example.com [--reset-2fa]'); process.exit(1); }

const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
process.stderr.write(`New password for ${email}: `);
rl._writeToOutput = () => {};
rl.on('line', async (pw) => {
  rl.close();
  process.stderr.write('\n');
  const err = strongPasswordError(pw, email);
  if (err) { console.error(`✖ ${err}`); process.exit(1); }
  const existing = (await getAdmin(email)) || { email, created_at: new Date().toISOString() };
  const rec = { ...existing, email, password_hash: await bcrypt.hash(pw, 12), failed_attempts: 0, locked_until: null };
  if (process.argv.includes('--reset-2fa')) { rec.totp_enabled = false; delete rec.totp_secret_enc; delete rec.totp_pending_enc; }
  await saveAdmin(rec);
  console.log(`✔ Admin ${email} saved to the vault${process.argv.includes('--reset-2fa') ? ' (2FA reset)' : ''}`);
});
