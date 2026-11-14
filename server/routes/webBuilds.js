import express from 'express';
import { requireUser } from '../lib/auth.js';
import { ah } from '../lib/http.js';
import { validate } from '../lib/validate.js';
import { websiteBuildBody } from '../lib/schemas.js';
import { baseUrl } from '../lib/config.js';
import { createWebsiteBuild } from '../services/buildService.js';

const router = express.Router();

// Web dashboard -> shared build pipeline.
router.post('/', requireUser, validate({ body: websiteBuildBody.omit({ webhook_url: true }) }), ah(async (req, res) => {
  const r = await createWebsiteBuild(req.body, { userId: req.user.id, source: 'web', callbackUrl: `${baseUrl(req)}/api/hooks/github` });
  res.status(201).json({ id: r.build.id, app_name: r.appName, package_name: r.packageName, url: r.url, runner: r.runner });
}));

export default router;
