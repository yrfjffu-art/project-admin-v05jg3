export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.expose = true;
    this.extra = extra;
  }
}

/** Wrap async handlers so rejections reach the error middleware. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function notFound(_req, res) {
  res.status(404).json({ error: 'Not found' });
}

/** Never leak stack traces or internal error text; log server-side only. */
export function errorHandler(err, req, res, _next) {
  if (res.headersSent) return;
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  if (err instanceof HttpError || err?.expose) {
    return res.status(err.status || 400).json({ error: err.message, ...(err.extra || {}) });
  }
  const ref = Math.random().toString(36).slice(2, 10);
  console.error(`[error ${ref}] ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ error: 'Internal server error', ref });
}
