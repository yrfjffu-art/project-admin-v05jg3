// Standalone server for Render / Railway / Fly / any VPS / Docker:  npm run start:server
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { createApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../dist');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';

const app = createApp();

// Static SPA with security headers (the API already got its own stricter headers).
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:', 'https://api.qrserver.com'],
      'connect-src': ["'self'", supabaseUrl, supabaseUrl.replace(/^https/, 'wss')].filter(Boolean),
      'frame-ancestors': ["'none'"],
      'form-action': ["'self'"],
    },
  },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, // Google sign-in popup
}));
app.use(express.static(dist, {
  index: false,
  setHeaders: (res, file) => res.setHeader('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache'),
}));
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`Web2APK server listening on :${port}`));
