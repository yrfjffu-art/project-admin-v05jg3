import express from 'express';
import supabase from '../../api/db-client.js';
import { ah } from '../lib/http.js';
import { validate, z } from '../lib/validate.js';
import { decrypt, safeEqual } from '../lib/crypto.js';
import { baseUrl } from '../lib/config.js';
import { tg, verifyWebhookSecret } from '../services/telegram.js';
import { createWebsiteBuild, buildStatus, publicStatus } from '../services/buildService.js';

const router = express.Router();

const HELP = [
  'I turn websites into Android apps (APK).',
  '',
  '/build <website_url> — build an APK, e.g. /build https://example.com',
  '/status <build_id> — check a build',
  '/mybuilds — your recent builds',
].join('\n');

const ICON = { queued: '⏳', building: '⚙️', success: '✅', failed: '❌' };

function describe(p) {
  const lines = [`${ICON[p.status] || '•'} Build #${p.id} — ${p.status}`];
  if (p.app_name) lines.push(`App: ${p.app_name}${p.package_name ? ` (${p.package_name})` : ''}`);
  if (p.url) lines.push(`Site: ${p.url}`);
  if (p.apk_url) lines.push(`APK: ${p.apk_url}`);
  if (p.status === 'failed' && p.error) lines.push(`Error: ${String(p.error).slice(0, 400)}`);
  return lines.join('\n');
}

// Telegram -> shared build pipeline. Authenticated by the per-bot secret_token header.
router.post('/:hookId', validate({ params: z.object({ hookId: z.string().regex(/^[A-Za-z0-9_-]{10,40}$/) }) }), ah(async (req, res) => {
  const { data: bot } = await supabase.from('telegram_bots').select('*').eq('hook_id', req.params.hookId).maybeSingle();
  if (!bot || !safeEqual(bot.hook_id, req.params.hookId)) return res.status(404).json({ error: 'Not found' });
  if (!verifyWebhookSecret(bot, req.headers['x-telegram-bot-api-secret-token'])) return res.status(401).json({ error: 'Unauthorized' });
  if (!bot.enabled || bot.disabled_by_admin) return res.json({ ok: true });

  const msg = req.body?.message;
  const text = typeof msg?.text === 'string' ? msg.text.trim().slice(0, 3000) : '';
  const chatId = Number(msg?.chat?.id);
  if (!text || !Number.isSafeInteger(chatId)) return res.json({ ok: true });
  await supabase.from('telegram_bots').update({ last_update_at: new Date().toISOString() }).eq('id', bot.id);

  const token = decrypt(bot.token_enc);
  const reply = (t) => tg(token, 'sendMessage', { chat_id: chatId, text: t, disable_web_page_preview: true, reply_to_message_id: msg.message_id }).catch(() => {});
  const m = text.match(/^\/([a-z_]+)(?:@(\w+))?(?:\s+([\s\S]*))?$/i);
  if (!m) { await reply(HELP); return res.json({ ok: true }); }
  const [, cmdRaw, mention, argRaw] = m;
  if (mention && bot.bot_username && mention.toLowerCase() !== bot.bot_username.toLowerCase()) return res.json({ ok: true });
  const cmd = cmdRaw.toLowerCase();
  const arg = (argRaw || '').trim();
  const isOwner = bot.owner_chat_id && Number(bot.owner_chat_id) === chatId;
  const allowed = isOwner || bot.allow_public;

  if (cmd === 'start') {
    if (arg && bot.link_code && !bot.owner_chat_id && safeEqual(arg, bot.link_code)) {
      await supabase.from('telegram_bots').update({ owner_chat_id: chatId, link_code: null }).eq('id', bot.id);
      await reply(`🔗 This chat is now linked as the owner of the bot.\n\n${HELP}`);
    } else {
      await reply(allowed ? HELP : `${HELP}\n\n🔒 This bot is private. Ask its owner to enable public access.`);
    }
    return res.json({ ok: true });
  }

  if (!allowed) { await reply('🔒 This bot is private.'); return res.json({ ok: true }); }

  if (cmd === 'build') {
    if (!arg) { await reply('Usage: /build https://example.com'); return res.json({ ok: true }); }
    const url = arg.split(/\s+/)[0];
    try {
      const r = await createWebsiteBuild({ url: /^https?:\/\//i.test(url) ? url : `https://${url}` }, {
        userId: bot.user_id,
        source: 'telegram',
        telegram: { botId: bot.id, chatId },
        callbackUrl: `${baseUrl(req)}/api/hooks/github`,
      });
      await reply(`🧱 Build #${r.build.id} queued\nApp: ${r.appName} (${r.packageName})\n${r.runner === 'cloud' ? 'Compiling on GitHub Actions — I will send the APK here when it is ready (about 2–4 min).' : 'Waiting for a build server to pick it up.'}\nCheck anytime: /status ${r.build.id}`);
    } catch (e) {
      await reply(`⚠️ ${e.expose ? e.message : 'Could not start the build. Please try again later.'}`);
      if (!e.expose) console.error('[telegram build]', e);
    }
    return res.json({ ok: true });
  }

  if (cmd === 'status') {
    const id = Number(arg);
    const s = Number.isSafeInteger(id) && id > 0 ? await buildStatus(id) : null;
    if (!s || s.meta?.telegram_bot_id !== bot.id || Number(s.meta?.telegram_chat_id) !== chatId) await reply('Build not found in this chat. Usage: /status 123');
    else await reply(describe(s.public));
    return res.json({ ok: true });
  }

  if (cmd === 'mybuilds') {
    const { data: metas } = await supabase.from('build_meta').select('build_id, app_name, created_at').eq('telegram_bot_id', bot.id).eq('telegram_chat_id', chatId).order('build_id', { ascending: false }).limit(10);
    if (!metas?.length) { await reply('No builds yet. Try /build https://example.com'); return res.json({ ok: true }); }
    const { data: builds } = await supabase.from('builds').select('id, status').in('id', metas.map((x) => x.build_id));
    const st = new Map((builds || []).map((b) => [b.id, publicStatus(b.status)]));
    await reply(metas.map((x) => `${ICON[st.get(x.build_id)] || '•'} #${x.build_id} ${x.app_name || ''} — ${st.get(x.build_id) || 'unknown'}`).join('\n'));
    return res.json({ ok: true });
  }

  await reply(HELP);
  res.json({ ok: true });
}));

export default router;
