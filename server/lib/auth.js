import supabase from '../../api/db-client.js';
import { HttpError } from './http.js';

// CORS is handled centrally by the Express app (allowlist). Kept for the route modules
// that still call it so their code stays unchanged.
export function cors() {}

export function isBanned(user) {
  return !!user?.banned_until && new Date(user.banned_until).getTime() > Date.now();
}

export async function getUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || token.length > 4096) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  if (isBanned(data.user)) return null;
  return data.user;
}

/** Express middleware: requires a signed-in, non-banned Supabase user. */
export async function requireUser(req, _res, next) {
  try {
    const user = await getUser(req);
    if (!user) throw new HttpError(401, 'Unauthorized');
    req.user = user;
    next();
  } catch (e) { next(e); }
}

const activeCache = new Map();
/** Used where the actor is not the user themselves (Telegram, API keys). */
export async function assertUserActive(userId) {
  const c = activeCache.get(userId);
  if (c && Date.now() - c.at < 60_000) { if (!c.ok) throw new HttpError(403, 'This account is suspended'); return; }
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  const ok = !error && !!data?.user && !isBanned(data.user);
  activeCache.set(userId, { ok, at: Date.now() });
  if (!ok) throw new HttpError(403, 'This account is suspended');
}
