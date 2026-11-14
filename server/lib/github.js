import JSZip from 'jszip';
import supabase from '../../api/db-client.js';
import { readSecret } from './vault.js';
import { buildCallbackKey } from './crypto.js';
import { FORGE_WORKFLOW, FORGE_WORKFLOW_PATH, FORGE_WORKFLOW_VERSION, ERROR_PATTERN } from './forgeWorkflow.js';

const GH = 'https://api.github.com';

export async function gh(token, path, opts = {}) {
  const r = await fetch(path.startsWith('http') ? path : GH + path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'apk-forge',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
  });
  if (opts.raw) return r;
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { message: text }; }
  if (!r.ok) {
    const err = new Error(`GitHub ${r.status}: ${json?.message || text}`.slice(0, 300));
    err.status = r.status;
    throw err;
  }
  return json;
}

export async function getConn(userId) {
  return readSecret(`github/${userId}.json`);
}

const esc = (s) => String(s ?? '').replace(/[^\w.:\-;]/g, '');
const escArgs = (s) => String(s ?? '').replace(/[^\w\s.=:\-\/]/g, '');

const ERROR_RE = new RegExp(ERROR_PATTERN);
const NOISE_RE = /^\s+at (org\.gradle|org\.jetbrains|java\.base|kotlin\.)/;

// Returns the last `n` lines of the first step in a GitHub job log that reported ##[error].
// Steps start at "##[group]Run ..." lines; post-job cleanup is excluded.
export function failedStepTail(cleanLog, n = 200) {
  const lines = cleanLog.split('\n');
  const starts = [];
  lines.forEach((l, i) => { if (/^##\[group\]Run /.test(l)) starts.push(i); });
  for (let k = 0; k < starts.length; k++) {
    let section = lines.slice(starts[k], k + 1 < starts.length ? starts[k + 1] : lines.length);
    const post = section.findIndex((l) => /^Post job cleanup\./.test(l));
    if (post > 0) section = section.slice(0, post);
    if (section.some((l) => l.startsWith('##[error]'))) {
      return summarize(section[0].replace(/^##\[group\]/, ''), section, n);
    }
  }
  const errAt = lines.findIndex((l) => l.startsWith('##[error]'));
  const end = errAt >= 0 ? errAt + 1 : lines.length;
  return summarize('job log', lines.slice(0, end), n);
}

function summarize(title, section, n) {
  const kept = section.filter((l) => !NOISE_RE.test(l));
  // Skip our own echoed summary so the same lines aren't counted twice.
  const raw = [];
  let inSummary = false;
  for (const l of kept) {
    if (l.startsWith('===== FORGE: ERROR LINES')) inSummary = true;
    if (!inSummary) raw.push(l);
    if (l.startsWith('===== FORGE: END')) inSummary = false;
  }
  const errorLines = raw.filter((l) => ERROR_RE.test(l)).slice(0, 80);
  const wwStart = raw.findIndex((l) => l.startsWith('* What went wrong:'));
  let whatWentWrong = '';
  if (wwStart >= 0) {
    const wwEnd = raw.findIndex((l, i) => i > wwStart && l.startsWith('* Try:'));
    whatWentWrong = raw.slice(wwStart, wwEnd > 0 ? wwEnd + 1 : wwStart + 30).join('\n');
  }
  const firstError = errorLines.find((l) => /^e: /.test(l)) || errorLines.find((l) => /error:|Unresolved reference|Cannot find symbol/.test(l)) || null;
  return { title, tail: kept.slice(-n).join('\n'), errorLines: errorLines.join('\n'), whatWentWrong, firstError };
}

const workflowReady = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Install/upgrade the static forge-build.yml on the repo's default branch (once per version). */
export async function ensureWorkflow(conn) {
  const { token, repo } = conn;
  const cached = workflowReady.get(repo);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached;
  const info = await gh(token, `/repos/${repo}`);
  const ref = info.default_branch;
  let sha = null;
  let current = '';
  try {
    const f = await gh(token, `/repos/${repo}/contents/${FORGE_WORKFLOW_PATH}?ref=${encodeURIComponent(ref)}`);
    sha = f.sha;
    current = Buffer.from(f.content || '', 'base64').toString('utf8');
  } catch (e) { if (e.status !== 404) throw e; }
  let fresh = false;
  if (!current.includes(`forge-workflow-version: ${FORGE_WORKFLOW_VERSION})`)) {
    await gh(token, `/repos/${repo}/contents/${FORGE_WORKFLOW_PATH}`, {
      method: 'PUT',
      body: JSON.stringify({ message: `APK Forge build workflow v${FORGE_WORKFLOW_VERSION}`, content: Buffer.from(FORGE_WORKFLOW).toString('base64'), branch: ref, ...(sha ? { sha } : {}) }),
    });
    fresh = true;
  }
  const out = { ref, fresh, at: Date.now() };
  workflowReady.set(repo, out);
  return out;
}

/**
 * Trigger a cloud build and return immediately. The runner downloads the source through a
 * short-lived signed URL and reports back via signed callbacks to /api/hooks/github.
 */
export async function dispatchCloud(build, project, conn, { callbackUrl } = {}) {
  const { token, repo } = conn;
  if (!project?.zip_path) throw new Error('Project has no source zip');
  const { ref, fresh } = await ensureWorkflow(conn);
  const { data: signed, error } = await supabase.storage.from('project-zips').createSignedUrl(project.zip_path, 2 * 60 * 60);
  if (error || !signed?.signedUrl) throw new Error('Could not create a download link for the project zip');
  const job = {
    build_id: build.id,
    source_url: signed.signedUrl,
    task: esc(build.gradle_task) || 'assembleDebug',
    jdk: esc(build.jdk_version) || '17',
    sdk_platform: esc(build.sdk_platform) || '35',
    build_tools: esc(build.build_tools) || '35.0.0',
    gradle: esc(build.gradle_version) || '8.11.1',
    extra: escArgs(build.extra_args),
    callback_url: callbackUrl || '',
    callback_key: callbackUrl ? buildCallbackKey(build.id) : '',
  };
  // A workflow file committed seconds ago may not be dispatchable yet - retry briefly.
  for (let attempt = 0; ; attempt++) {
    try {
      await gh(token, `/repos/${repo}/actions/workflows/forge-build.yml/dispatches`, {
        method: 'POST',
        body: JSON.stringify({ ref, inputs: { job: JSON.stringify(job) } }),
      });
      break;
    } catch (e) {
      if (attempt < (fresh ? 5 : 1) && (e.status === 404 || e.status === 422)) { await sleep(2000); continue; }
      throw e;
    }
  }
  return `workflow_dispatch@${ref}`;
}

async function downloadRedirect(token, url) {
  const first = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'apk-forge', Accept: 'application/vnd.github+json' }, redirect: 'manual' });
  if (first.status >= 300 && first.status < 400) {
    const loc = first.headers.get('location');
    const r = await fetch(loc);
    if (!r.ok) throw new Error(`Download failed ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }
  if (!first.ok) throw new Error(`Download failed ${first.status}`);
  return Buffer.from(await first.arrayBuffer());
}

const STEP_ICON = { success: '✔', failure: '✖', cancelled: '■', skipped: '·' };

export async function syncCloud(build, conn) {
  const { token, repo } = conn;
  if (!['queued', 'running'].includes(build.status)) return build;
  const { data: cr } = await supabase.from('cloud_runs').select('*').eq('build_id', build.id).maybeSingle();
  const branch = cr?.branch || `forge-build-${build.id}`;
  const now = new Date().toISOString();
  const header = (build.logs || '').split('\n[cloud:steps]')[0];

  let run = null;
  if (cr?.run_id) {
    run = await gh(token, `/repos/${repo}/actions/runs/${cr.run_id}`);
  } else if (String(cr?.branch || '').startsWith('workflow_dispatch')) {
    const runs = await gh(token, `/repos/${repo}/actions/workflows/forge-build.yml/runs?event=workflow_dispatch&per_page=30`);
    run = (runs.workflow_runs || []).find((r) => r.display_title === `Forge build #${build.id}`) || null;
  } else {
    const runs = await gh(token, `/repos/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=5`);
    run = (runs.workflow_runs || []).find((r) => r.event === 'push') || null;
  }
  if (!run) {
    const age = Date.now() - new Date(build.created_at).getTime();
    if (age > 5 * 60 * 1000) {
      const patch = { status: 'failed', finished_at: now, error: 'GitHub did not start the workflow. Make sure Actions are enabled on the repo and the token has the "workflow" scope.' };
      await supabase.from('builds').update(patch).eq('id', build.id);
      return { ...build, ...patch };
    }
    return build;
  }

  const jobs = await gh(token, `/repos/${repo}/actions/runs/${run.id}/jobs`);
  const job = jobs.jobs?.[0];
  const stepLines = (job?.steps || []).map((s) => {
    const icon = s.status === 'completed' ? (STEP_ICON[s.conclusion] || '•') : s.status === 'in_progress' ? '▶' : '○';
    const dur = s.started_at && s.completed_at ? ` (${Math.round((new Date(s.completed_at) - new Date(s.started_at)) / 1000)}s)` : '';
    return `${icon} ${s.name}${dur}`;
  });
  if (!cr?.run_id) await supabase.from('cloud_runs').update({ run_id: run.id, run_url: run.html_url }).eq('build_id', build.id);
  const patch = {};
  if (!build.started_at) patch.started_at = run.run_started_at || now;
  if (build.status === 'queued') patch.status = 'running';
  let logs = `${header}\n[cloud:steps] GitHub Actions run ${run.html_url}\n${stepLines.join('\n')}\n`;

  let failureDetail = null;
  if (run.status === 'completed') {
    patch.finished_at = run.updated_at || now;
    if (job) {
      try {
        const raw = (await downloadRedirect(token, `${GH}/repos/${repo}/actions/jobs/${job.id}/logs`)).toString('utf8');
        const clean = raw.split('\n').map((l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, '')).join('\n');
        if (run.conclusion !== 'success') {
          const { title, tail, errorLines, whatWentWrong, firstError } = failedStepTail(clean, 200);
          if (firstError) failureDetail = firstError.replace(/file:\/\/\/home\/runner\/work\/[^/]+\/[^/]+\/src\//, '');
          logs += `\n[cloud] ── error lines ──\n${errorLines || '(none matched)'}\n`;
          if (whatWentWrong) logs += `\n[cloud] ── what went wrong ──\n${whatWentWrong}\n`;
          logs += `\n[cloud] ── failed step: ${title} (last 200 lines, Gradle/JDK/Kotlin stack frames removed) ──\n${tail}\n[cloud] ── end of failed step ──\n`;
        }
        logs += `\n[cloud] ── full log ──\n${clean.slice(-300000)}\n`;
      } catch (e) { logs += `[cloud] (could not fetch full log: ${e.message})\n`; }
    }
    if (run.conclusion === 'success') {
      try {
        const arts = await gh(token, `/repos/${repo}/actions/runs/${run.id}/artifacts`);
        const art = (arts.artifacts || []).find((a) => a.name === 'apk');
        if (!art) throw new Error('APK artifact missing');
        const zipBuf = await downloadRedirect(token, art.archive_download_url);
        const z = await JSZip.loadAsync(zipBuf);
        const apks = Object.keys(z.files).filter((n) => n.endsWith('.apk'));
        if (!apks.length) throw new Error('No .apk inside artifact');
        apks.sort((a, b) => (/release/.test(b) ? 1 : 0) - (/release/.test(a) ? 1 : 0));
        const apk = await z.file(apks[0]).async('nodebuffer');
        const name = apks[0].split('/').pop().replace(/[^\w.-]/g, '_');
        const p = `${build.user_id}/build-${build.id}/${name}`;
        const { error } = await supabase.storage.from('apks').upload(p, apk, { contentType: 'application/vnd.android.package-archive', upsert: true });
        if (error) throw error;
        patch.apk_url = supabase.storage.from('apks').getPublicUrl(p).data.publicUrl;
        patch.apk_size = apk.length;
        patch.status = 'success';
        logs += `[cloud] ✔ APK ready: ${name} (${(apk.length / 1048576).toFixed(2)} MB)\n`;
      } catch (e) {
        patch.status = 'failed';
        patch.error = `Build passed but APK could not be collected: ${e.message}`;
      }
    } else {
      patch.status = run.conclusion === 'cancelled' ? 'cancelled' : 'failed';
      if (patch.status === 'failed') {
        const failed = (job?.steps || []).find((s) => s.conclusion === 'failure');
        patch.error = `Failed at step "${failed?.name || 'unknown'}"${failureDetail ? ` — ${failureDetail}` : ' — see the log below.'}`.slice(0, 1000);
      }
    }
    if (!branch.startsWith('workflow_dispatch')) gh(token, `/repos/${repo}/git/refs/heads/${branch}`, { method: 'DELETE' }).catch(() => {});
  }
  patch.logs = logs;
  const { data } = await supabase.from('builds').update(patch).eq('id', build.id).eq('status', build.status).select().maybeSingle();
  return data || { ...build, ...patch };
}
