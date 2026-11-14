import supabase from '../../api/db-client.js';
import { decrypt, hmacHex } from '../lib/crypto.js';
import { safeFetch } from '../lib/ssrf.js';
import { tg } from './telegram.js';

const TERMINAL = new Set(['success', 'failed', 'cancelled']);
const apiStatus = (s) => ({ queued: 'queued', running: 'building', success: 'success', failed: 'failed', cancelled: 'failed' }[s] || s);
const mb = (n) => (n ? `${(n / 1048576).toFixed(2)} MB` : '');

async function telegramNotify(build, meta) {
  if (!meta.telegram_bot_id || !meta.telegram_chat_id) return;
  const { data: bot } = await supabase.from('telegram_bots').select('id, token_enc, enabled, disabled_by_admin').eq('id', meta.telegram_bot_id).maybeSingle();
  if (!bot || !bot.enabled || bot.disabled_by_admin) return;
  const token = decrypt(bot.token_enc);
  const chat_id = meta.telegram_chat_id;
  const name = meta.app_name || 'your app';
  if (build.status === 'running') {
    return tg(token, 'sendMessage', { chat_id, text: `⚙️ Build #${build.id} (${name}) is now compiling on GitHub Actions…` });
  }
  if (build.status === 'success' && build.apk_url) {
    const caption = `✅ ${name} is ready — build #${build.id}${build.apk_size ? ` · ${mb(build.apk_size)}` : ''}\n${meta.package_name || ''}`;
    try {
      return await tg(token, 'sendDocument', { chat_id, document: build.apk_url, caption });
    } catch {
      return tg(token, 'sendMessage', { chat_id, text: `${caption}\nDownload: ${build.apk_url}` });
    }
  }
  if (build.status === 'failed') {
    return tg(token, 'sendMessage', { chat_id, text: `❌ Build #${build.id} (${name}) failed.\n${String(build.error || 'See the dashboard for the full log.').slice(0, 800)}` });
  }
  if (build.status === 'cancelled') {
    return tg(token, 'sendMessage', { chat_id, text: `■ Build #${build.id} was cancelled.` });
  }
}

async function webhookNotify(build, meta) {
  if (!meta.webhook_url || !TERMINAL.has(build.status) || !meta.api_key_id) return;
  const { data: key } = await supabase.from('api_keys').select('id, webhook_secret_enc').eq('id', meta.api_key_id).maybeSingle();
  if (!key?.webhook_secret_enc) return;
  const secret = decrypt(key.webhook_secret_enc);
  const body = JSON.stringify({
    event: 'build.finished',
    id: build.id,
    status: apiStatus(build.status),
    url: meta.site_url,
    app_name: meta.app_name,
    package_name: meta.package_name,
    apk_url: build.apk_url,
    apk_size: build.apk_size,
    error: build.error,
    finished_at: build.finished_at,
  });
  const ts = Math.floor(Date.now() / 1000);
  const sig = hmacHex(secret, `${ts}.${body}`);
  let result;
  try {
    const r = await safeFetch(meta.webhook_url, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', 'x-web2apk-signature': `t=${ts},v1=${sig}`, 'x-web2apk-event': 'build.finished' },
      maxRedirects: 0,
      timeoutMs: 8000,
      maxBytes: 64 * 1024,
      allowHttp: false,
      field: 'webhook_url',
    });
    result = `delivered (HTTP ${r.status})`;
  } catch (e) {
    result = `failed: ${String(e.message).slice(0, 200)}`;
  }
  await supabase.from('build_meta').update({ webhook_status: result }).eq('build_id', build.id);
}

/**
 * Send Telegram / webhook notifications for the build's current status, at most once per
 * status (claimed atomically through build_meta.notified_status).
 */
export async function notifyBuild(buildId) {
  const { data: build } = await supabase.from('builds').select('id, status, apk_url, apk_size, error, finished_at').eq('id', buildId).maybeSingle();
  if (!build) return;
  const { data: meta } = await supabase.from('build_meta').select('*').eq('build_id', buildId).maybeSingle();
  if (!meta || meta.notified_status === build.status) return;
  let q = supabase.from('build_meta').update({ notified_status: build.status }).eq('build_id', buildId);
  q = meta.notified_status === null ? q.is('notified_status', null) : q.eq('notified_status', meta.notified_status);
  const { data: claimed } = await q.select('build_id').maybeSingle();
  if (!claimed) return;
  const results = await Promise.allSettled([telegramNotify(build, meta), webhookNotify(build, meta)]);
  for (const r of results) if (r.status === 'rejected') console.error('[notify]', buildId, r.reason?.message);
}
