import express from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { authenticator } from 'otplib';
import supabase from '../../api/db-client.js';
import { config } from '../lib/config.js';
import { ah, HttpError } from '../lib/http.js';
import { validate, z, idStr } from '../lib/validate.js';
import { decrypt, encrypt, hmacHash, randomToken, safeEqual } from '../lib/crypto.js';
import { getSettings, saveSettings } from '../lib/settings.js';
import { disconnectBot, resyncBot, publicBot } from '../services/telegram.js';
import { baseUrl } from '../lib/config.js';
import { getAdmin, saveAdmin } from './store.js';
import { adminPage } from './page.js';

authenticator.options = { window: 1 };

const AT = '__Host-w2a_at';
const RT = '__Host-w2a_rt';
const CSRF = '__Host-w2a_csrf';
const ACCESS_TTL_S = 10 * 60;
const REFRESH_TTL_MS = 8 * 60 * 60 * 1000;
const DUMMY_HASH = '$2b$12$XCw3/QwYqpZ3kKsemPz/b.uC5RAtuO3Gn7hY8eWTFNQg32kx/Slta'; // hash of a random, discarded password (timing equaliser)
const cookieBase = { httpOnly: true, secure: true, sameSite: 'strict', path: '/' };

const notFound = () => new HttpError(404, 'Not found');
const ip = (req) => req.ip || null;

async function audit(req, action, target = null, details = null) {
  await supabase.from('admin_audit').insert({ admin_email: req.admin?.email || details?.email || null, action, target: target == null ? null : String(target), details, ip: ip(req) });
}

function issueAccess(res, email, sid) {
  const token = jwt.sign({ sid }, config.adminJwtSecret, { algorithm: 'HS256', subject: email, audience: 'web2apk-admin', issuer: 'web2apk', expiresIn: ACCESS_TTL_S });
  res.cookie(AT, token, { ...cookieBase, maxAge: ACCESS_TTL_S * 1000 });
}

function issueCsrf(res) {
  res.cookie(CSRF, randomToken(24), { ...cookieBase, httpOnly: false, maxAge: REFRESH_TTL_MS });
}

function clearCookies(res) {
  for (const c of [AT, RT, CSRF]) res.clearCookie(c, { ...cookieBase, httpOnly: c !== CSRF });
}

async function createSession(req, res, email) {
  const sid = crypto.randomUUID();
  const refresh = randomToken(32);
  await supabase.from('admin_sessions').insert({
    id: sid, admin_email: email, refresh_hash: hmacHash(refresh, 'admin-refresh'),
    expires_at: new Date(Date.now() + REFRESH_TTL_MS).toISOString(), ip: ip(req), user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
  });
  issueAccess(res, email, sid);
  res.cookie(RT, `${sid}.${refresh}`, { ...cookieBase, maxAge: REFRESH_TTL_MS });
  issueCsrf(res);
}

async function liveSession(sid, email) {
  const { data: s } = await supabase.from('admin_sessions').select('*').eq('id', sid).maybeSingle();
  if (!s || s.revoked_at || new Date(s.expires_at).getTime() < Date.now() || s.admin_email !== email) return null;
  return s;
}

/** Same-origin check for cookie-authenticated, state-changing requests. */
function sameOrigin(req) {
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return false;
  try { return new URL(origin).host === String(req.headers['x-forwarded-host'] || req.headers.host).split(',')[0].trim(); } catch { return false; }
}

async function requireAdmin(req, _res, next) {
  try {
    const tok = req.cookies?.[AT];
    if (!tok) throw notFound();
    let claims;
    try { claims = jwt.verify(tok, config.adminJwtSecret, { algorithms: ['HS256'], audience: 'web2apk-admin', issuer: 'web2apk' }); } catch { throw notFound(); }
    if (!(await liveSession(claims.sid, claims.sub))) throw notFound();
    req.admin = { email: claims.sub, sid: claims.sid };
    if (req.method !== 'GET') {
      if (!sameOrigin(req) || !safeEqual(req.headers['x-csrf-token'], req.cookies?.[CSRF])) throw new HttpError(403, 'CSRF check failed');
    }
    next();
  } catch (e) { next(e); }
}

function strongPasswordError(pw, email) {
  if (pw.length < 14) return 'Use at least 14 characters';
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (classes < 3) return 'Use at least three of: lowercase, uppercase, digits, symbols';
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 3 && pw.toLowerCase().includes(local)) return 'Password must not contain your email name';
  return null;
}

export function adminRouter() {
  const r = express.Router();

  r.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  });

  r.get('/', (req, res) => {
    const nonce = randomToken(16);
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
    res.setHeader('X-Frame-Options', 'DENY');
    res.type('html').send(adminPage(nonce));
  });

  // Per-IP limiter on top of the per-account lockout stored in the vault.
  const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many login attempts. Try again later.' } });

  r.post('/login', loginLimiter, validate({ body: z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(200), totp: z.string().regex(/^\d{6}$/).optional() }).strict() }), ah(async (req, res) => {
    if (!sameOrigin(req)) throw new HttpError(403, 'CSRF check failed');
    const { email, password, totp } = req.body;
    const admin = await getAdmin(email);
    const generic = new HttpError(401, 'Invalid credentials');
    if (!admin) { await bcrypt.compare(password, DUMMY_HASH); await audit(req, 'login_failed', email, { email, reason: 'unknown' }); throw generic; }
    if (admin.locked_until && new Date(admin.locked_until).getTime() > Date.now()) {
      await audit(req, 'login_blocked', email, { email });
      throw new HttpError(429, 'Account temporarily locked after repeated failures. Try again later.');
    }
    const fail = async (reason) => {
      admin.failed_attempts = (admin.failed_attempts || 0) + 1;
      if (admin.failed_attempts >= 5) {
        const minutes = 15 * 2 ** Math.min(admin.failed_attempts - 5, 4);
        admin.locked_until = new Date(Date.now() + minutes * 60_000).toISOString();
      }
      await saveAdmin(admin);
      await audit(req, 'login_failed', email, { email, reason, attempts: admin.failed_attempts });
    };
    if (!(await bcrypt.compare(password, admin.password_hash))) { await fail('password'); throw generic; }
    if (admin.totp_enabled) {
      if (!totp) throw new HttpError(401, 'Two-factor code required', { totp_required: true });
      if (!authenticator.check(totp, decrypt(admin.totp_secret_enc))) { await fail('totp'); throw new HttpError(401, 'Invalid two-factor code', { totp_required: true }); }
    }
    admin.failed_attempts = 0;
    admin.locked_until = null;
    admin.last_login_at = new Date().toISOString();
    await saveAdmin(admin);
    await createSession(req, res, admin.email);
    req.admin = { email: admin.email };
    await audit(req, 'login', admin.email);
    res.json({ ok: true, email: admin.email, totp_enabled: !!admin.totp_enabled });
  }));

  r.post('/refresh', ah(async (req, res) => {
    if (!sameOrigin(req)) throw notFound();
    const [sid, refresh] = String(req.cookies?.[RT] || '').split('.');
    if (!sid || !refresh) throw notFound();
    const { data: s } = await supabase.from('admin_sessions').select('*').eq('id', sid).maybeSingle();
    if (!s || s.revoked_at || new Date(s.expires_at).getTime() < Date.now() || !safeEqual(s.refresh_hash, hmacHash(refresh, 'admin-refresh'))) {
      if (s && !s.revoked_at) await supabase.from('admin_sessions').update({ revoked_at: new Date().toISOString() }).eq('id', sid);
      clearCookies(res);
      throw notFound();
    }
    const next = randomToken(32);
    await supabase.from('admin_sessions').update({ refresh_hash: hmacHash(next, 'admin-refresh') }).eq('id', sid);
    issueAccess(res, s.admin_email, sid);
    res.cookie(RT, `${sid}.${next}`, { ...cookieBase, maxAge: new Date(s.expires_at).getTime() - Date.now() });
    res.json({ ok: true });
  }));

  // Everything below requires a valid admin session; failures look like a normal 404.
  r.use(requireAdmin);

  r.post('/logout', ah(async (req, res) => {
    await supabase.from('admin_sessions').update({ revoked_at: new Date().toISOString() }).eq('id', req.admin.sid);
    await audit(req, 'logout');
    clearCookies(res);
    res.json({ ok: true });
  }));

  r.get('/me', ah(async (req, res) => {
    const a = await getAdmin(req.admin.email);
    res.json({ email: req.admin.email, totp_enabled: !!a?.totp_enabled });
  }));

  r.get('/stats', ah(async (_req, res) => {
    const c = async (q) => (await q).count || 0;
    const b = () => supabase.from('builds').select('id', { count: 'exact', head: true });
    const day = new Date(Date.now() - 86400_000).toISOString();
    const [total, success, failed, active, last24, keys, bots, users] = await Promise.all([
      c(b()), c(b().eq('status', 'success')), c(b().eq('status', 'failed')), c(b().in('status', ['queued', 'running'])), c(b().gte('created_at', day)),
      c(supabase.from('api_keys').select('id', { count: 'exact', head: true }).is('revoked_at', null)),
      c(supabase.from('telegram_bots').select('id', { count: 'exact', head: true })),
      supabase.auth.admin.listUsers({ page: 1, perPage: 1 }).then((x) => x.data?.total ?? null).catch(() => null),
    ]);
    const bySource = {};
    for (const s of ['web', 'telegram', 'api', 'zip']) bySource[s] = await c(supabase.from('build_meta').select('build_id', { count: 'exact', head: true }).eq('source', s));
    res.json({ builds: { total, success, failed, active, last24 }, success_rate: success + failed ? Math.round((success / (success + failed)) * 100) : null, api_keys_active: keys, telegram_bots: bots, users, by_source: bySource });
  }));

  r.get('/users', validate({ query: z.object({ page: idStr.optional() }).strict() }), ah(async (req, res) => {
    const page = Number(req.query.page || 1);
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 50 });
    if (error) throw error;
    res.json({ page, users: data.users.map((u) => ({ id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at, banned_until: u.banned_until || null, provider: u.app_metadata?.provider || null })) });
  }));

  const uuidParam = validate({ params: z.object({ id: z.string().uuid() }) });
  r.post('/users/:id/ban', uuidParam, validate({ body: z.object({ hours: z.number().int().min(1).max(876000).optional(), reason: z.string().max(300).optional() }).strict() }), ah(async (req, res) => {
    const hours = req.body.hours || 876000;
    const { error } = await supabase.auth.admin.updateUserById(req.params.id, { ban_duration: `${hours}h` });
    if (error) throw new HttpError(400, 'Could not ban user');
    await audit(req, 'user_ban', req.params.id, { hours, reason: req.body.reason || null });
    res.json({ ok: true });
  }));
  r.post('/users/:id/unban', uuidParam, ah(async (req, res) => {
    const { error } = await supabase.auth.admin.updateUserById(req.params.id, { ban_duration: 'none' });
    if (error) throw new HttpError(400, 'Could not unban user');
    await audit(req, 'user_unban', req.params.id);
    res.json({ ok: true });
  }));

  r.get('/builds', validate({ query: z.object({ status: z.enum(['queued', 'running', 'success', 'failed', 'cancelled']).optional(), user_id: z.string().uuid().optional(), offset: z.string().regex(/^\d{1,7}$/).optional() }).strict() }), ah(async (req, res) => {
    const off = Number(req.query.offset || 0);
    let q = supabase.from('builds').select('id, user_id, status, gradle_task, agent_name, apk_url, apk_size, error, created_at, finished_at, projects(name, package_name)').order('id', { ascending: false }).range(off, off + 49);
    if (req.query.status) q = q.eq('status', req.query.status);
    if (req.query.user_id) q = q.eq('user_id', req.query.user_id);
    const { data, error } = await q;
    if (error) throw error;
    const { data: metas } = await supabase.from('build_meta').select('build_id, source, site_url, app_name').in('build_id', data.map((b) => b.id).concat([0]));
    const m = new Map((metas || []).map((x) => [x.build_id, x]));
    res.json(data.map((b) => ({ ...b, meta: m.get(b.id) || null })));
  }));

  r.get('/builds/:id', validate({ params: z.object({ id: idStr }) }), ah(async (req, res) => {
    const { data } = await supabase.from('builds').select('*, projects(name, package_name)').eq('id', Number(req.params.id)).maybeSingle();
    if (!data) throw notFound();
    const { data: meta } = await supabase.from('build_meta').select('*').eq('build_id', data.id).maybeSingle();
    await audit(req, 'build_view', data.id);
    res.json({ ...data, meta });
  }));

  r.get('/api-keys', ah(async (_req, res) => {
    const { data, error } = await supabase.from('api_keys').select('id, user_id, name, prefix, rate_per_hour, monthly_quota, last_used_at, revoked_at, created_at').order('id', { ascending: false }).limit(500);
    if (error) throw error;
    res.json(data);
  }));
  r.post('/api-keys/:id/revoke', validate({ params: z.object({ id: idStr }) }), ah(async (req, res) => {
    await supabase.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', Number(req.params.id)).is('revoked_at', null);
    await audit(req, 'api_key_revoke', req.params.id);
    res.json({ ok: true });
  }));
  r.put('/api-keys/:id/limits', validate({ params: z.object({ id: idStr }), body: z.object({ rate_per_hour: z.number().int().min(0).max(10000), monthly_quota: z.number().int().min(0).max(1_000_000) }).strict() }), ah(async (req, res) => {
    await supabase.from('api_keys').update(req.body).eq('id', Number(req.params.id));
    await audit(req, 'api_key_limits', req.params.id, req.body);
    res.json({ ok: true });
  }));

  r.get('/bots', ah(async (_req, res) => {
    const { data, error } = await supabase.from('telegram_bots').select('id, user_id, bot_id, bot_username, link_code, owner_chat_id, allow_public, enabled, disabled_by_admin, webhook_ok, last_update_at, created_at').order('id');
    if (error) throw error;
    res.json(data.map((b) => ({ ...publicBot(b), user_id: b.user_id, link_url: undefined })));
  }));
  r.post('/bots/:id/disable', validate({ params: z.object({ id: idStr }) }), ah(async (req, res) => {
    const { data: bot } = await supabase.from('telegram_bots').select('*').eq('id', Number(req.params.id)).maybeSingle();
    if (!bot) throw notFound();
    await disconnectBot(bot);
    await supabase.from('telegram_bots').update({ disabled_by_admin: true, webhook_ok: false }).eq('id', bot.id);
    await audit(req, 'bot_disable', bot.id, { bot_username: bot.bot_username });
    res.json({ ok: true });
  }));
  r.post('/bots/:id/enable', validate({ params: z.object({ id: idStr }) }), ah(async (req, res) => {
    const { data: bot } = await supabase.from('telegram_bots').select('*').eq('id', Number(req.params.id)).maybeSingle();
    if (!bot) throw notFound();
    await supabase.from('telegram_bots').update({ disabled_by_admin: false }).eq('id', bot.id);
    let webhook = 'ok';
    try { await resyncBot(bot, baseUrl(req)); } catch (e) { webhook = `failed: ${e.message}`; }
    await audit(req, 'bot_enable', bot.id, { bot_username: bot.bot_username, webhook });
    res.json({ ok: true, webhook });
  }));

  const settingsSchema = z.object({
    builds_enabled: z.boolean(), default_rate_per_hour: z.number().int().min(0).max(10000), default_monthly_quota: z.number().int().min(0).max(1_000_000),
    web_builds_per_hour: z.number().int().min(0).max(10000), telegram_builds_per_hour: z.number().int().min(0).max(10000),
    max_active_api_keys: z.number().int().min(0).max(1000), max_telegram_bots: z.number().int().min(0).max(100),
  }).partial().strict();
  r.get('/settings', ah(async (_req, res) => res.json(await getSettings())));
  r.put('/settings', validate({ body: settingsSchema }), ah(async (req, res) => {
    const next = await saveSettings(req.body);
    await audit(req, 'settings_update', null, req.body);
    res.json(next);
  }));

  r.get('/audit', ah(async (_req, res) => {
    const { data, error } = await supabase.from('admin_audit').select('*').order('id', { ascending: false }).limit(300);
    if (error) throw error;
    res.json(data);
  }));

  r.post('/totp/setup', ah(async (req, res) => {
    const a = await getAdmin(req.admin.email);
    const secret = authenticator.generateSecret(20);
    a.totp_pending_enc = encrypt(secret);
    await saveAdmin(a);
    await audit(req, 'totp_setup_started');
    res.json({ secret, otpauth: authenticator.keyuri(a.email, 'Web2APK Admin', secret) });
  }));
  r.post('/totp/enable', validate({ body: z.object({ code: z.string().regex(/^\d{6}$/) }).strict() }), ah(async (req, res) => {
    const a = await getAdmin(req.admin.email);
    if (!a.totp_pending_enc || !authenticator.check(req.body.code, decrypt(a.totp_pending_enc))) throw new HttpError(400, 'Code does not match — check your authenticator app clock');
    a.totp_secret_enc = a.totp_pending_enc;
    a.totp_enabled = true;
    delete a.totp_pending_enc;
    await saveAdmin(a);
    await audit(req, 'totp_enabled');
    res.json({ ok: true });
  }));
  r.post('/totp/disable', validate({ body: z.object({ password: z.string().min(1).max(200), code: z.string().regex(/^\d{6}$/) }).strict() }), ah(async (req, res) => {
    const a = await getAdmin(req.admin.email);
    if (!(await bcrypt.compare(req.body.password, a.password_hash)) || !a.totp_enabled || !authenticator.check(req.body.code, decrypt(a.totp_secret_enc))) throw new HttpError(400, 'Password or code is wrong');
    a.totp_enabled = false;
    delete a.totp_secret_enc;
    await saveAdmin(a);
    await audit(req, 'totp_disabled');
    res.json({ ok: true });
  }));
  r.post('/password', validate({ body: z.object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200) }).strict() }), ah(async (req, res) => {
    const a = await getAdmin(req.admin.email);
    if (!(await bcrypt.compare(req.body.current, a.password_hash))) throw new HttpError(400, 'Current password is wrong');
    const weak = strongPasswordError(req.body.next, a.email);
    if (weak) throw new HttpError(400, weak);
    a.password_hash = await bcrypt.hash(req.body.next, 12);
    await saveAdmin(a);
    await supabase.from('admin_sessions').update({ revoked_at: new Date().toISOString() }).eq('admin_email', a.email).neq('id', req.admin.sid).is('revoked_at', null);
    await audit(req, 'password_changed');
    res.json({ ok: true });
  }));
  r.post('/sessions/revoke-all', ah(async (req, res) => {
    await supabase.from('admin_sessions').update({ revoked_at: new Date().toISOString() }).eq('admin_email', req.admin.email).is('revoked_at', null);
    await audit(req, 'sessions_revoked');
    clearCookies(res);
    res.json({ ok: true });
  }));

  return r;
}

export { strongPasswordError };
