import express from 'express';
import supabase from '../../api/db-client.js';
import { ah, HttpError } from '../lib/http.js';
import { validate, parseOrThrow } from '../lib/validate.js';
import { githubCallback, githubCallbackPayload } from '../lib/schemas.js';
import { buildCallbackKey, hmacHex, safeEqual } from '../lib/crypto.js';
import { notifyBuild } from '../services/notify.js';

const router = express.Router();
const ACTIVE = ['queued', 'running'];

async function appendLogs(id, text) {
  const { data } = await supabase.from('builds').select('logs').eq('id', id).maybeSingle();
  await supabase.from('builds').update({ logs: ((data?.logs || '') + text).slice(-400_000) }).eq('id', id);
}

/**
 * Signed callbacks from the GitHub Actions run.
 * sig = HMAC_SHA256(perBuildKey, `${build_id}.${ts}.${payload}`), payload = base64(JSON).
 */
router.post('/github', validate({ body: githubCallback }), ah(async (req, res) => {
  const { build_id, ts, payload, sig } = req.body;
  const expected = hmacHex(buildCallbackKey(build_id), `${build_id}.${ts}.${payload}`);
  if (!safeEqual(expected, sig)) throw new HttpError(401, 'Invalid signature');
  if (Math.abs(Date.now() / 1000 - ts) > 15 * 60) throw new HttpError(401, 'Stale callback');
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')); } catch { throw new HttpError(400, 'Invalid payload'); }
  const p = parseOrThrow(githubCallbackPayload, data);

  const { data: build } = await supabase.from('builds').select('id, user_id, status, started_at').eq('id', build_id).maybeSingle();
  if (!build) throw new HttpError(404, 'Build not found');
  const now = new Date().toISOString();
  await supabase.from('build_meta').update({ last_callback_at: now }).eq('build_id', build_id);
  if (!ACTIVE.includes(build.status)) return res.json({ ok: true, ignored: `build is ${build.status}` });

  if (p.event === 'started') {
    await supabase.from('builds').update({ status: 'running', started_at: build.started_at || now }).eq('id', build_id).in('status', ACTIVE);
    if (p.run_id) await supabase.from('cloud_runs').upsert({ build_id, user_id: build.user_id, run_id: Number(p.run_id), run_url: p.run_url || null });
    await appendLogs(build_id, `[cloud] Runner started: ${p.run_url || 'GitHub Actions'}\n`);
    await notifyBuild(build_id).catch(() => {});
    return res.json({ ok: true });
  }

  if (p.event === 'upload-url') {
    const name = String(p.apk_name || 'app.apk').replace(/[^\w.-]/g, '_').slice(0, 100);
    if (!name.endsWith('.apk')) throw new HttpError(400, 'Only .apk files can be uploaded');
    const path = `${build.user_id}/build-${build_id}/${Date.now()}-${name}`;
    const { data: up, error } = await supabase.storage.from('apks').createSignedUploadUrl(path);
    if (error) throw error;
    return res.json({ signed_url: up.signedUrl, path });
  }

  if (p.event === 'cancelled') {
    await supabase.from('builds').update({ status: 'cancelled', finished_at: now }).eq('id', build_id).in('status', ACTIVE);
    await appendLogs(build_id, '[cloud] Run was cancelled\n');
    await notifyBuild(build_id).catch(() => {});
    return res.json({ ok: true });
  }

  // finished
  if (p.status === 'success') {
    const prefix = `${build.user_id}/build-${build_id}/`;
    if (!p.apk_path || !p.apk_path.startsWith(prefix) || p.apk_path.includes('..')) throw new HttpError(400, 'Invalid apk_path');
    const folder = p.apk_path.slice(0, p.apk_path.lastIndexOf('/'));
    const file = p.apk_path.slice(p.apk_path.lastIndexOf('/') + 1);
    const { data: listed } = await supabase.storage.from('apks').list(folder, { search: file, limit: 5 });
    if (!listed?.some((o) => o.name === file)) throw new HttpError(400, 'APK was not uploaded');
    const apk_url = supabase.storage.from('apks').getPublicUrl(p.apk_path).data.publicUrl;
    await supabase.from('builds').update({ status: 'success', finished_at: now, apk_url, apk_size: p.apk_size ?? null }).eq('id', build_id).in('status', ACTIVE);
    await appendLogs(build_id, `[cloud] ✔ BUILD SUCCESSFUL — APK uploaded (${p.apk_size ? (p.apk_size / 1048576).toFixed(2) + ' MB' : 'size unknown'})\n`);
  } else {
    const first = (p.error_lines || '').split('\n').map((l) => l.replace(/^\d+:/, '')).find((l) => /^e: /.test(l))
      || (p.error_lines || '').split('\n').map((l) => l.replace(/^\d+:/, '')).find((l) => /error:|Unresolved reference|Cannot find symbol/.test(l));
    const detail = first ? first.replace(/file:\/\/\/home\/runner\/work\/[^/]+\/[^/]+\/src\//, '') : 'see the log below.';
    const error = `Failed at step "${p.failed_step || 'unknown'}" — ${detail}`.slice(0, 1000);
    await supabase.from('builds').update({ status: 'failed', finished_at: now, error }).eq('id', build_id).in('status', ACTIVE);
    let log = '\n[cloud] ── error lines ──\n' + (p.error_lines || '(none matched)\n');
    if (p.what_went_wrong) log += '\n[cloud] ── what went wrong ──\n' + p.what_went_wrong;
    log += `\n[cloud] ── failed step: ${p.failed_step || 'unknown'} (last 200 lines, Gradle/JDK/Kotlin stack frames removed) ──\n${p.log_tail || ''}\n[cloud] ── end of failed step ──\n`;
    await appendLogs(build_id, log);
  }
  await notifyBuild(build_id).catch(() => {});
  res.json({ ok: true });
}));

export default router;
