import express from 'express';
import rateLimit from 'express-rate-limit';
import supabase from '../../api/db-client.js';
import { ah, HttpError } from '../lib/http.js';
import { validate, z, idStr } from '../lib/validate.js';
import { websiteBuildBody } from '../lib/schemas.js';
import { hmacHash } from '../lib/crypto.js';
import { baseUrl } from '../lib/config.js';
import { assertUserActive } from '../lib/auth.js';
import { createWebsiteBuild, buildStatus } from '../services/buildService.js';

const router = express.Router();

// Coarse per-IP limiter (per-key hourly limit + monthly quota are enforced in buildService).
router.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many requests' } }));

const KEY_RE = /^w2a_[A-Za-z0-9_-]{32}$/;

async function apiKeyAuth(req, _res, next) {
  try {
    const raw = String(req.headers.authorization || '');
    const key = raw.startsWith('Bearer ') ? raw.slice(7).trim() : '';
    if (!KEY_RE.test(key)) throw new HttpError(401, 'Missing or malformed API key (Authorization: Bearer w2a_...)');
    const { data: k } = await supabase.from('api_keys').select('id, user_id, name, rate_per_hour, monthly_quota, revoked_at').eq('key_hash', hmacHash(key, 'api-key')).maybeSingle();
    if (!k || k.revoked_at) throw new HttpError(401, 'Invalid or revoked API key');
    await assertUserActive(k.user_id);
    await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', k.id);
    req.apiKey = k;
    next();
  } catch (e) { next(e); }
}

router.use(apiKeyAuth);

router.post('/build', validate({ body: websiteBuildBody }), ah(async (req, res) => {
  const base = baseUrl(req);
  const r = await createWebsiteBuild(req.body, { userId: req.apiKey.user_id, source: 'api', apiKey: req.apiKey, callbackUrl: `${base}/api/hooks/github` });
  res.status(202).json({
    id: r.build.id,
    status: 'queued',
    app_name: r.appName,
    package_name: r.packageName,
    url: r.url,
    status_url: `${base}/api/v1/build/${r.build.id}`,
  });
}));

router.get('/build/:id', validate({ params: z.object({ id: idStr }) }), ah(async (req, res) => {
  const s = await buildStatus(Number(req.params.id));
  // Only builds created through the API by this key's owner are visible.
  if (!s || s.meta?.user_id !== req.apiKey.user_id || s.meta?.source !== 'api') throw new HttpError(404, 'Build not found');
  res.json(s.public);
}));

export default router;
