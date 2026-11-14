import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './lib/config.js';
import { errorHandler, notFound } from './lib/http.js';
import { byMethod } from './lib/validate.js';
import { legacy } from './lib/schemas.js';
import { safeEqual } from './lib/crypto.js';
import projects from './routes/projects.js';
import upload from './routes/upload.js';
import builds from './routes/builds.js';
import toolchains from './routes/toolchains.js';
import agents from './routes/agents.js';
import agent from './routes/agent.js';
import cloud from './routes/cloud.js';
import webBuilds from './routes/webBuilds.js';
import apiKeys from './routes/apiKeys.js';
import v1 from './routes/v1.js';
import telegramBots from './routes/telegramBots.js';
import telegramWebhook from './routes/telegramWebhook.js';
import hooks from './routes/hooks.js';
import { adminRouter } from './admin/router.js';

const selfOrigin = (req) => {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${proto}://${host}`;
};

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // server-to-server (agents, Telegram, GitHub, API clients)
  if (origin === selfOrigin(req) || config.corsOrigins.includes(origin)) return true;
  return req.path.startsWith('/v1/') && config.apiCorsOrigins.includes(origin);
}

/** Body parser that also works when the host (e.g. Vercel) already parsed the body. */
function jsonBody(limit) {
  const parse = express.json({ limit, strict: true });
  return (req, res, next) => {
    let pre;
    try { pre = req.body; } catch { return next(Object.assign(new Error('bad json'), { type: 'entity.parse.failed' })); }
    if (pre && typeof pre === 'object' && !Buffer.isBuffer(pre)) return next();
    return parse(req, res, next);
  };
}

/** Adapt the existing (req, res) handlers: validate first, then forward errors. */
const legacyRoute = (schemas, handler) => [byMethod(schemas), (req, res, next) => Promise.resolve(handler(req, res)).catch(next)];

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Netlify Functions mount the app under /.netlify/functions/api
  app.use((req, _res, next) => {
    if (req.url.startsWith('/.netlify/functions/api')) req.url = '/api' + req.url.slice('/.netlify/functions/api'.length);
    next();
  });

  app.use('/api', helmet({
    contentSecurityPolicy: { useDefaults: false, directives: { 'default-src': ["'none'"], 'frame-ancestors': ["'none'"], 'base-uri': ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
    referrerPolicy: { policy: 'no-referrer' },
  }));

  // CORS allowlist + hard block of cross-site state-changing requests from unknown origins.
  app.use('/api', cors((req, cb) => cb(null, {
    origin: originAllowed(req) ? (req.headers.origin || false) : false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Agent-Token', 'X-CSRF-Token'],
    credentials: false,
    maxAge: 600,
  })));
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'OPTIONS' && !originAllowed(req)) return res.status(403).json({ error: 'Origin not allowed' });
    next();
  });

  app.use('/api', jsonBody('1mb'));
  app.use('/api', cookieParser());
  app.use('/api', rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests' },
    // Machine callers are authenticated separately and have their own limits.
    skip: (req) => req.path.startsWith('/telegram/webhook/') || req.path.startsWith('/hooks/') || req.path === '/agent',
  }));

  // Existing dashboard routes (same URLs as before, now validated with zod).
  app.all('/api/projects', ...legacyRoute(legacy.projects, projects));
  app.all('/api/upload', ...legacyRoute(legacy.upload, upload));
  app.all('/api/builds', ...legacyRoute(legacy.builds, builds));
  app.all('/api/toolchains', ...legacyRoute(legacy.toolchains, toolchains));
  app.all('/api/agents', ...legacyRoute(legacy.agents, agents));
  app.all('/api/agent', ...legacyRoute(legacy.agent, agent));
  app.all('/api/cloud', ...legacyRoute(legacy.cloud, cloud));

  // New features
  app.use('/api/web-builds', webBuilds);
  app.use('/api/api-keys', apiKeys);
  app.use('/api/telegram-bots', telegramBots);
  app.use('/api/telegram/webhook', telegramWebhook);
  app.use('/api/hooks', hooks);
  app.use('/api/v1', v1);
  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // Hidden admin console: only mounted for the exact secret segment; anything else is a plain 404.
  const admin = adminRouter();
  app.use('/api/:seg', (req, res, next) => {
    const p = config.adminPath;
    if (!p || !safeEqual(req.params.seg, p)) return next();
    return admin(req, res, next);
  });

  app.use('/api', notFound);
  app.use(errorHandler);
  return app;
}
