import { z } from 'zod';
import { HttpError } from './http.js';

function format(err) {
  const i = err.issues[0];
  const where = i?.path?.length ? `${i.path.join('.')}: ` : '';
  return `${where}${i?.message || 'Invalid input'}`;
}

/** Express middleware: validate req.body / req.query / req.params with zod (unknown keys rejected). */
export function validate({ body, query, params } = {}) {
  return (req, _res, next) => {
    try {
      if (params) req.params = params.parse(req.params);
      if (query) {
        const q = query.parse(req.query || {});
        Object.defineProperty(req, 'query', { value: q, writable: true, configurable: true, enumerable: true });
      }
      if (body) req.body = body.parse(req.body ?? {});
      next();
    } catch (e) {
      if (e instanceof z.ZodError) return next(new HttpError(400, format(e)));
      next(e);
    }
  };
}

/** Pick the schema for the current HTTP method. */
export function byMethod(map) {
  return (req, res, next) => {
    const s = map[req.method];
    if (s === undefined) return next(new HttpError(405, 'Method not allowed'));
    if (s === null) return next();
    return validate(s)(req, res, next);
  };
}

export function parseOrThrow(schema, value) {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, format(r.error));
  return r.data;
}

// Reusable field schemas
export const id = z.coerce.number().int().positive().max(2_147_483_647);
export const idStr = z.string().regex(/^\d{1,10}$/, 'must be a numeric id');
export const version = z.string().max(32).regex(/^[\w.+-]*$/, 'invalid characters');
export const optVersion = version.nullish();
export const gradleTask = z.string().trim().min(1).max(200).regex(/^[\w:-]+$/, 'only letters, digits, ":", "_" and "-" are allowed');
export const extraArgs = z.string().max(300).regex(/^[\w\s.=:\-/]*$/, 'contains disallowed characters').nullish();
export const moduleName = z.string().max(100).regex(/^[\w\-:/]*$/, 'invalid module name').nullish();
export { z };
