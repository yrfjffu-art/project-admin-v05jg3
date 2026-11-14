// Thin Vercel wrapper: every /api/* request is rewritten (vercel.json) to this ONE function,
// which keeps the deployment far below the function-count limit. All logic lives in the
// host-agnostic Express app in /server (also used by server/index.js and the Netlify wrapper).
import { createApp } from '../server/app.js';

const app = createApp();

export default function handler(req, res) {
  // The rewrite passes the original sub-path as ?__path=...; restore the real URL so Express
  // routes exactly as it would on any other host, and expose a plain query object.
  const u = new URL(req.url, 'http://localhost');
  const p = u.searchParams.get('__path');
  if (p !== null) {
    u.searchParams.delete('__path');
    u.searchParams.delete('path'); // older rewrite param name, never a real query key here
    u.pathname = `/api/${p}`;
  }
  req.url = u.pathname + u.search;
  Object.defineProperty(req, 'query', { value: Object.fromEntries(u.searchParams), writable: true, configurable: true, enumerable: true });
  return app(req, res);
}
