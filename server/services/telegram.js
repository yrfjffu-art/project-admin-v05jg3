import supabase from '../../api/db-client.js';
import { HttpError } from '../lib/http.js';
import { decrypt, encrypt, hmacHash, randomToken, safeEqual } from '../lib/crypto.js';
import { getSettings } from '../lib/settings.js';

export const TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/;

export class TelegramError extends Error {}

/** Call the Bot API. The token never appears in errors or logs. */
export async function tg(token, method, params = {}) {
  let r;
  try {
    r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new TelegramError('Could not reach Telegram');
  }
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new TelegramError(String(j.description || `Telegram error ${r.status}`).slice(0, 200));
  return j.result;
}

const COMMANDS = [
  { command: 'start', description: 'Welcome & help' },
  { command: 'build', description: 'Build an APK: /build https://example.com' },
  { command: 'status', description: 'Build status: /status 123' },
  { command: 'mybuilds', description: 'Your recent builds' },
];

async function installWebhook(token, hookId, secret, base) {
  await tg(token, 'setWebhook', {
    url: `${base}/api/telegram/webhook/${hookId}`,
    secret_token: secret,
    allowed_updates: ['message'],
    drop_pending_updates: true,
    max_connections: 10,
  });
  await tg(token, 'setMyCommands', { commands: COMMANDS }).catch(() => {});
}

export function publicBot(b) {
  return {
    id: b.id,
    bot_id: b.bot_id,
    bot_username: b.bot_username,
    allow_public: b.allow_public,
    enabled: b.enabled,
    disabled_by_admin: b.disabled_by_admin,
    webhook_ok: b.webhook_ok,
    owner_linked: !!b.owner_chat_id,
    link_url: !b.owner_chat_id && b.bot_username && b.link_code ? `https://t.me/${b.bot_username}?start=${b.link_code}` : null,
    last_update_at: b.last_update_at,
    created_at: b.created_at,
  };
}

/** Validate a bot token with getMe, encrypt it, install the webhook with a secret_token. */
export async function connectBot(userId, token, base) {
  if (!TOKEN_RE.test(token)) throw new HttpError(400, 'That is not a valid bot token (format 123456789:ABC… from @BotFather)');
  if (!base.startsWith('https://')) throw new HttpError(400, 'Telegram webhooks need an https:// deployment (set PUBLIC_BASE_URL)');
  let me;
  try { me = await tg(token, 'getMe'); } catch { throw new HttpError(400, 'Telegram rejected this token (getMe failed)'); }
  if (!me?.is_bot) throw new HttpError(400, 'This token does not belong to a bot');

  const { data: taken } = await supabase.from('telegram_bots').select('id, user_id').eq('bot_id', me.id);
  if ((taken || []).some((b) => b.user_id !== userId)) throw new HttpError(409, 'This bot is already connected to another account');
  const settings = await getSettings();
  const { count } = await supabase.from('telegram_bots').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  if (!(taken || []).length && (count || 0) >= settings.max_telegram_bots) throw new HttpError(400, `You can connect up to ${settings.max_telegram_bots} bots`);

  const hookId = randomToken(18);
  const secret = randomToken(32);
  const row = {
    user_id: userId,
    bot_id: me.id,
    bot_username: me.username || null,
    token_enc: encrypt(token),
    hook_id: hookId,
    secret_hash: hmacHash(secret, 'tg-secret'),
    link_code: randomToken(12),
    enabled: true,
    webhook_ok: false,
  };
  let bot;
  if ((taken || []).length) {
    const { data, error } = await supabase.from('telegram_bots').update({ ...row, owner_chat_id: null }).eq('id', taken[0].id).select().single();
    if (error) throw error;
    bot = data;
  } else {
    const { data, error } = await supabase.from('telegram_bots').insert(row).select().single();
    if (error) throw error;
    bot = data;
  }
  try {
    await installWebhook(token, hookId, secret, base);
    const { data } = await supabase.from('telegram_bots').update({ webhook_ok: true }).eq('id', bot.id).select().single();
    bot = data;
  } catch (e) {
    throw new HttpError(502, `Bot saved, but setting the webhook failed: ${e.message}`);
  }
  return publicBot(bot);
}

/** Re-issue hook id + secret and re-install the webhook (e.g. after moving hosts). */
export async function resyncBot(bot, base) {
  const token = decrypt(bot.token_enc);
  const hookId = randomToken(18);
  const secret = randomToken(32);
  await supabase.from('telegram_bots').update({ hook_id: hookId, secret_hash: hmacHash(secret, 'tg-secret'), webhook_ok: false }).eq('id', bot.id);
  await installWebhook(token, hookId, secret, base);
  const { data } = await supabase.from('telegram_bots').update({ webhook_ok: true }).eq('id', bot.id).select().single();
  return data;
}

export async function disconnectBot(bot) {
  try { await tg(decrypt(bot.token_enc), 'deleteWebhook', { drop_pending_updates: true }); } catch { /* token may already be revoked */ }
}

export function verifyWebhookSecret(bot, headerValue) {
  if (!headerValue || typeof headerValue !== 'string' || headerValue.length > 256) return false;
  return safeEqual(hmacHash(headerValue, 'tg-secret'), bot.secret_hash);
}
