import express from 'express';
import supabase from '../../api/db-client.js';
import { requireUser } from '../lib/auth.js';
import { ah, HttpError } from '../lib/http.js';
import { validate, z, idStr } from '../lib/validate.js';
import { encrypt, hmacHash, randomToken } from '../lib/crypto.js';
import { getSettings } from '../lib/settings.js';

const router = express.Router();
router.use(requireUser);

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(); };

router.get('/', ah(async (req, res) => {
  const { data, error } = await supabase.from('api_keys')
    .select('id, name, prefix, rate_per_hour, monthly_quota, last_used_at, revoked_at, created_at')
    .eq('user_id', req.user.id).order('id', { ascending: false });
  if (error) throw error;
  const out = await Promise.all(data.map(async (k) => {
    const { count } = await supabase.from('build_meta').select('build_id', { count: 'exact', head: true }).eq('api_key_id', k.id).gte('created_at', monthStart());
    return { ...k, used_this_month: count || 0 };
  }));
  res.json(out);
}));

router.post('/', validate({ body: z.object({ name: z.string().trim().min(1, 'Name is required').max(60) }).strict() }), ah(async (req, res) => {
  const settings = await getSettings();
  const { count } = await supabase.from('api_keys').select('id', { count: 'exact', head: true }).eq('user_id', req.user.id).is('revoked_at', null);
  if ((count || 0) >= settings.max_active_api_keys) throw new HttpError(400, `You can have at most ${settings.max_active_api_keys} active keys`);
  const key = `w2a_${randomToken(24)}`;
  const webhookSecret = `whsec_${randomToken(24)}`;
  const { data, error } = await supabase.from('api_keys').insert({
    user_id: req.user.id,
    name: req.body.name,
    prefix: key.slice(0, 12),
    key_hash: hmacHash(key, 'api-key'),
    webhook_secret_enc: encrypt(webhookSecret),
    rate_per_hour: settings.default_rate_per_hour,
    monthly_quota: settings.default_monthly_quota,
  }).select('id, name, prefix, rate_per_hour, monthly_quota, created_at').single();
  if (error) throw error;
  // The only time the full key and webhook secret are ever returned.
  res.status(201).json({ ...data, key, webhook_secret: webhookSecret });
}));

router.delete('/:id', validate({ params: z.object({ id: idStr }) }), ah(async (req, res) => {
  const { data, error } = await supabase.from('api_keys').update({ revoked_at: new Date().toISOString() })
    .eq('id', Number(req.params.id)).eq('user_id', req.user.id).is('revoked_at', null).select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'Key not found or already revoked');
  res.json({ ok: true });
}));

export default router;
