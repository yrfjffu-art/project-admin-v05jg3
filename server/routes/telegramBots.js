import express from 'express';
import supabase from '../../api/db-client.js';
import { requireUser } from '../lib/auth.js';
import { ah, HttpError } from '../lib/http.js';
import { validate, z, idStr } from '../lib/validate.js';
import { baseUrl } from '../lib/config.js';
import { connectBot, disconnectBot, publicBot, resyncBot } from '../services/telegram.js';

const router = express.Router();
router.use(requireUser);

const own = async (req) => {
  const { data } = await supabase.from('telegram_bots').select('*').eq('id', Number(req.params.id)).eq('user_id', req.user.id).maybeSingle();
  if (!data) throw new HttpError(404, 'Bot not found');
  return data;
};

// The encrypted token is never selected for or returned to the frontend.
router.get('/', ah(async (req, res) => {
  const { data, error } = await supabase.from('telegram_bots')
    .select('id, bot_id, bot_username, link_code, owner_chat_id, allow_public, enabled, disabled_by_admin, webhook_ok, last_update_at, created_at')
    .eq('user_id', req.user.id).order('id');
  if (error) throw error;
  res.json(data.map(publicBot));
}));

router.post('/', validate({ body: z.object({ token: z.string().trim().min(10).max(100) }).strict() }), ah(async (req, res) => {
  res.status(201).json(await connectBot(req.user.id, req.body.token, baseUrl(req)));
}));

router.put('/:id', validate({ params: z.object({ id: idStr }), body: z.object({ allow_public: z.boolean().optional(), enabled: z.boolean().optional(), resync: z.literal(true).optional(), unlink_owner: z.literal(true).optional() }).strict() }), ah(async (req, res) => {
  let bot = await own(req);
  const patch = {};
  if (req.body.allow_public !== undefined) patch.allow_public = req.body.allow_public;
  if (req.body.enabled !== undefined) patch.enabled = req.body.enabled;
  if (req.body.unlink_owner) Object.assign(patch, { owner_chat_id: null, link_code: (await import('../lib/crypto.js')).randomToken(12) });
  if (Object.keys(patch).length) {
    const { data, error } = await supabase.from('telegram_bots').update(patch).eq('id', bot.id).select().single();
    if (error) throw error;
    bot = data;
  }
  if (req.body.resync) {
    if (bot.disabled_by_admin) throw new HttpError(403, 'This bot was disabled by an administrator');
    try { bot = await resyncBot(bot, baseUrl(req)); } catch (e) { throw new HttpError(502, `Webhook setup failed: ${e.message}`); }
  }
  res.json(publicBot(bot));
}));

router.delete('/:id', validate({ params: z.object({ id: idStr }) }), ah(async (req, res) => {
  const bot = await own(req);
  await disconnectBot(bot);
  await supabase.from('telegram_bots').delete().eq('id', bot.id);
  res.json({ ok: true });
}));

export default router;
