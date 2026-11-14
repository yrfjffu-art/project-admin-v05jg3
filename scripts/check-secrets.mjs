#!/usr/bin/env node
// Fails (exit 1) if anything that looks like a real secret is about to be committed or shipped.
// Usage: npm run check:secrets            (scan working tree)
//        npm run check:secrets -- --staged (scan only files staged in git; used by the pre-commit hook)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.git', '.vercel', '.netlify', 'coverage']);
const SKIP_FILES = new Set(['package-lock.json', 'check-secrets.mjs']);
const TEXT_EXT = /\.(m?[jt]sx?|json|ya?ml|toml|env|md|html|css|txt|sh|sql|properties|kts|gradle|xml|ini|conf)$|^\.env|Dockerfile$/i;

const RULES = [
  { name: 'Supabase secret key', re: /\bsb_secret_[A-Za-z0-9_-]{20,}/g },
  { name: 'GitHub token', re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{50,}/g },
  { name: 'Telegram bot token', re: /\b\d{8,12}:AA[A-Za-z0-9_-]{33}\b/g },
  { name: 'Private key', re: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Web2APK API key', re: /\bw2a_[A-Za-z0-9_-]{32}\b/g },
  { name: 'Webhook secret', re: /\bwhsec_[A-Za-z0-9_-]{32}\b/g },
  { name: 'Agent token', re: /\bfa_[a-f0-9]{48}\b/g },
  { name: 'bcrypt hash in env', re: /ADMIN_PASSWORD_HASH\s*=\s*\$2[aby]\$/g },
];

function isServiceRoleJwt(tok) {
  try {
    const payload = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString('utf8'));
    return payload.role === 'service_role';
  } catch { return false; }
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out); }
    else out.push(path.relative(ROOT, path.join(dir, e.name)));
  }
  return out;
}

const staged = process.argv.includes('--staged');
let files;
if (staged) {
  files = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' }).split('\n').filter(Boolean);
} else {
  files = walk(ROOT).filter((f) => !f.startsWith('dist' + path.sep) || /\.(js|html)$/.test(f));
}

const findings = [];
for (const f of files) {
  const base = path.basename(f);
  if (SKIP_FILES.has(base) || !TEXT_EXT.test(base) || !fs.existsSync(f)) continue;
  if (/^\.env(\..*)?$/.test(base) && base !== '.env.example' && !staged) continue; // local env files are allowed on disk, just never staged
  if (staged && /^\.env(\..*)?$/.test(base) && base !== '.env.example') { findings.push(`${f}: .env files must never be committed`); continue; }
  const text = fs.readFileSync(f, 'utf8');
  if (text.length > 5_000_000) continue;
  for (const r of RULES) for (const m of text.matchAll(r.re)) findings.push(`${f}: ${r.name} (${m[0].slice(0, 10)}…)`);
  for (const m of text.matchAll(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
    if (isServiceRoleJwt(m[0])) findings.push(`${f}: Supabase service_role JWT`);
  }
  // The service-role key must only ever be read on the server.
  if (/^src[\\/]/.test(f) && /SERVICE_ROLE/.test(text)) findings.push(`${f}: frontend code references the service-role key`);
}

const gi = fs.existsSync('.gitignore') ? fs.readFileSync('.gitignore', 'utf8') : '';
if (!/^\.env$/m.test(gi)) findings.push('.gitignore: ".env" is not ignored');

if (findings.length) {
  console.error('\n✖ Possible secrets found:\n  ' + [...new Set(findings)].join('\n  ') + '\n\nRemove them (use environment variables) before committing.\n');
  process.exit(1);
}
console.log(`✔ Secret scan passed (${files.length} files checked${staged ? ', staged only' : ''})`);
