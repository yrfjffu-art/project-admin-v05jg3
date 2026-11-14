import supabase from '../../api/db-client.js';
import { HttpError } from '../lib/http.js';
import { assertPublicUrl, safeFetch } from '../lib/ssrf.js';
import { cleanAppName, derivePackageName, packageNameError } from '../lib/sanitize.js';
import { getSettings } from '../lib/settings.js';
import { assertUserActive } from '../lib/auth.js';
import { getConn, dispatchCloud } from '../lib/github.js';
import { generateWebViewProject, TEMPLATE_TOOLCHAIN } from './template.js';
import { notifyBuild } from './notify.js';

/** Public status names used by the v1 API / Telegram. */
export const publicStatus = (s) => ({ queued: 'queued', running: 'building', success: 'success', failed: 'failed', cancelled: 'failed' }[s] || s);

const hourAgo = () => new Date(Date.now() - 3600_000).toISOString();
const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(); };

async function count(q) {
  const { count: n, error } = await q;
  if (error) throw error;
  return n || 0;
}

/** Per-source limits: API key (hourly + monthly), Telegram chat (hourly), web user (hourly). */
export async function enforceLimits(ctx, settings) {
  const meta = () => supabase.from('build_meta').select('build_id', { count: 'exact', head: true });
  if (ctx.source === 'api') {
    const perHour = ctx.apiKey.rate_per_hour ?? settings.default_rate_per_hour;
    const quota = ctx.apiKey.monthly_quota ?? settings.default_monthly_quota;
    if ((await count(meta().eq('api_key_id', ctx.apiKey.id).gte('created_at', hourAgo()))) >= perHour) {
      throw new HttpError(429, `Rate limit reached (${perHour} builds per hour for this key)`);
    }
    if ((await count(meta().eq('api_key_id', ctx.apiKey.id).gte('created_at', monthStart()))) >= quota) {
      throw new HttpError(429, `Monthly quota reached (${quota} builds for this key)`);
    }
  } else if (ctx.source === 'telegram') {
    const limit = settings.telegram_builds_per_hour;
    if ((await count(meta().eq('telegram_bot_id', ctx.telegram.botId).eq('telegram_chat_id', ctx.telegram.chatId).gte('created_at', hourAgo()))) >= limit) {
      throw new HttpError(429, `Limit reached: ${limit} builds per hour from this chat`);
    }
  } else {
    const limit = settings.web_builds_per_hour;
    if ((await count(meta().eq('user_id', ctx.userId).eq('source', 'web').gte('created_at', hourAgo()))) >= limit) {
      throw new HttpError(429, `Limit reached: ${limit} website builds per hour`);
    }
  }
}

/** Validate + probe the website (SSRF-safe; redirects re-checked). Returns normalised URL + title. */
export async function inspectWebsite(rawUrl) {
  const u = await assertPublicUrl(rawUrl, { field: 'url' });
  let title = null;
  let finalUrl = u.href;
  try {
    const r = await safeFetch(u.href, { maxBytes: 512 * 1024, timeoutMs: 7000, maxRedirects: 5, field: 'url', headers: { accept: 'text/html,*/*' } });
    finalUrl = r.url;
    const html = r.body.toString('utf8');
    const m = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
    if (m) title = m[1].replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  } catch (e) {
    // A redirect to a private address is a hard failure; an unreachable site is not
    // (it may be down temporarily) - the app will simply show its offline page.
    if (/private or reserved|not allowed|credentials/.test(e.message)) throw e;
  }
  return { url: u.href, finalUrl, title };
}

const ICON_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export async function fetchIcon(iconUrl) {
  const r = await safeFetch(iconUrl, { maxBytes: 1024 * 1024, timeoutMs: 8000, field: 'icon_url', allowHttp: false });
  if (r.status !== 200) throw new HttpError(400, `icon_url: server answered ${r.status}`);
  const b = r.body;
  let ext = null;
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ext = 'png';
  else if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ext = 'jpg';
  else if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') ext = 'webp';
  const declared = ICON_TYPES[String(r.headers.get('content-type') || '').split(';')[0].trim()];
  if (!ext || (declared && declared !== ext)) throw new HttpError(400, 'icon_url: must be a PNG, JPEG or WebP image');
  return { data: b, ext };
}

async function upsertProject(userId, { appName, pkg, url, zipPath, zipSize }) {
  const analysis = {
    root: 'web2apk/', fileCount: 7, isAndroid: true, hasWrapper: false, dsl: 'kotlin', appModule: 'app',
    applicationId: pkg, namespace: pkg, compileSdk: Number(TEMPLATE_TOOLCHAIN.compileSdk), minSdk: TEMPLATE_TOOLCHAIN.minSdk,
    targetSdk: Number(TEMPLATE_TOOLCHAIN.compileSdk), agpVersion: TEMPLATE_TOOLCHAIN.agp, gradleVersion: null, javaVersion: '17',
    kotlin: true, recommendedJdk: '17', modules: ['app'], warnings: [], websiteUrl: url,
  };
  const zip_url = supabase.storage.from('project-zips').getPublicUrl(zipPath).data.publicUrl;
  const row = { name: appName, description: `Website app for ${url}`, zip_path: zipPath, zip_name: `${pkg}.zip`, zip_size: zipSize, zip_url, analysis, updated_at: new Date().toISOString() };
  const { data: existing } = await supabase.from('projects').select('id, zip_path').eq('user_id', userId).eq('package_name', pkg).order('id', { ascending: false }).limit(1);
  if (existing?.length) {
    const { data, error } = await supabase.from('projects').update(row).eq('id', existing[0].id).eq('user_id', userId).select().single();
    if (error) throw error;
    if (existing[0].zip_path && existing[0].zip_path !== zipPath) await supabase.storage.from('project-zips').remove([existing[0].zip_path]);
    return data;
  }
  const { data, error } = await supabase.from('projects').insert({ ...row, user_id: userId, package_name: pkg }).select().single();
  if (error) throw error;
  return data;
}

async function appendLog(id, line) {
  const { data } = await supabase.from('builds').select('logs').eq('id', id).maybeSingle();
  await supabase.from('builds').update({ logs: (data?.logs || '') + line }).eq('id', id);
}

/**
 * Start a cloud build for an existing build row (or leave it queued for a self-hosted agent).
 * Never compiles anything in-process: it only triggers GitHub Actions and returns.
 */
export async function dispatchBuild(build, project, { conn, callbackUrl }) {
  if (!conn) return build;
  try {
    const branch = await dispatchCloud(build, project, conn, { callbackUrl });
    await supabase.from('cloud_runs').upsert({ build_id: build.id, user_id: build.user_id, branch });
    await appendLog(build.id, `[forge] ✔ Triggered GitHub Actions in ${conn.repo} — waiting for a runner (usually 10–30s)\n`);
  } catch (e) {
    const msg = `Could not start cloud build: ${String(e.message || e).slice(0, 300)}`;
    await supabase.from('builds').update({ status: 'failed', finished_at: new Date().toISOString(), error: msg }).eq('id', build.id);
    await notifyBuild(build.id).catch(() => {});
    throw new HttpError(502, msg, { build_id: build.id });
  }
  return build;
}

/**
 * The ONE entry point for website -> APK builds (web UI, Telegram bot and public API).
 * ctx: { userId, source: 'web'|'telegram'|'api', apiKey?, telegram?: { botId, chatId }, callbackUrl }
 */
export async function createWebsiteBuild(input, ctx) {
  const settings = await getSettings();
  if (!settings.builds_enabled) throw new HttpError(503, 'Builds are temporarily disabled by the administrator');
  await assertUserActive(ctx.userId);
  await enforceLimits(ctx, settings);

  const site = await inspectWebsite(input.url);
  const appName = cleanAppName(input.app_name || site.title || new URL(site.url).hostname);
  let pkg;
  if (input.package_name) {
    const err = packageNameError(input.package_name);
    if (err) throw new HttpError(400, err);
    pkg = input.package_name;
  } else {
    pkg = derivePackageName(site.url);
  }
  const icon = input.icon_url ? await fetchIcon(input.icon_url) : null;
  if (input.webhook_url) await assertPublicUrl(input.webhook_url, { allowHttp: false, field: 'webhook_url' });

  const zip = await generateWebViewProject({ appName, packageName: pkg, url: site.url, icon });
  const zipPath = `${ctx.userId}/web/${pkg}-${Date.now()}.zip`;
  const { error: upErr } = await supabase.storage.from('project-zips').upload(zipPath, zip, { contentType: 'application/zip', upsert: false });
  if (upErr) throw upErr;
  const project = await upsertProject(ctx.userId, { appName, pkg, url: site.url, zipPath, zipSize: zip.length });

  const conn = await getConn(ctx.userId);
  const T = TEMPLATE_TOOLCHAIN;
  const via = { web: 'web dashboard', telegram: 'Telegram bot', api: 'public API' }[ctx.source];
  const { data: build, error } = await supabase.from('builds').insert({
    project_id: project.id,
    user_id: ctx.userId,
    status: 'queued',
    build_type: 'debug',
    module: 'app',
    gradle_task: ':app:assembleDebug',
    jdk_version: T.jdk,
    sdk_platform: T.compileSdk,
    build_tools: T.buildTools,
    gradle_version: T.gradle,
    ...(conn ? { agent_id: -1, agent_name: 'GitHub Actions (cloud)' } : {}),
    logs: `[forge] Website build for ${site.url} requested via ${via} at ${new Date().toISOString()}\n[forge] App "${appName}" · package ${pkg}${icon ? ' · custom icon' : ''}\n` +
      (conn ? '' : '[forge] No GitHub connection — waiting for a self-hosted build agent to claim this job…\n'),
  }).select().single();
  if (error) throw error;

  const { error: mErr } = await supabase.from('build_meta').insert({
    build_id: build.id,
    user_id: ctx.userId,
    source: ctx.source,
    site_url: site.url,
    app_name: appName,
    package_name: pkg,
    api_key_id: ctx.apiKey?.id ?? null,
    telegram_bot_id: ctx.telegram?.botId ?? null,
    telegram_chat_id: ctx.telegram?.chatId ?? null,
    webhook_url: input.webhook_url || null,
    notified_status: 'queued',
  });
  if (mErr) throw mErr;

  await dispatchBuild(build, project, { conn, callbackUrl: ctx.callbackUrl });
  return { build, appName, packageName: pkg, url: site.url, runner: conn ? 'cloud' : 'agent' };
}

/** Status document shared by the v1 API and the Telegram bot. */
export async function buildStatus(buildId, { tailLines = 40 } = {}) {
  const { data: b } = await supabase.from('builds').select('id, user_id, status, apk_url, apk_size, error, logs, created_at, started_at, finished_at').eq('id', buildId).maybeSingle();
  if (!b) return null;
  const { data: m } = await supabase.from('build_meta').select('*').eq('build_id', buildId).maybeSingle();
  const lines = String(b.logs || '').split('\n');
  return {
    build: b,
    meta: m,
    public: {
      id: b.id,
      status: publicStatus(b.status),
      url: m?.site_url ?? null,
      app_name: m?.app_name ?? null,
      package_name: m?.package_name ?? null,
      apk_url: b.apk_url,
      apk_size: b.apk_size,
      error: b.error,
      created_at: b.created_at,
      started_at: b.started_at,
      finished_at: b.finished_at,
      log_tail: lines.slice(-tailLines).join('\n'),
    },
  };
}
