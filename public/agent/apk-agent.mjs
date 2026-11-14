#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────
//  APK Forge build agent
//  Runs on any machine with Node 18+. JDK, Android SDK, build-tools and Gradle
//  are downloaded and managed automatically in ~/.apk-forge/tools.
//  It polls APK Forge for queued builds, downloads the project zip, runs
//  Gradle, streams logs back live and uploads the resulting APK.
//
//  Usage:
//    node apk-agent.mjs --server https://your-forge.app --token fa_xxx
//  Options:
//    --workdir <dir>   where projects are extracted (default: OS temp dir)
//    --keep            keep build directories after finishing
//  Env fallbacks: APK_FORGE_SERVER, APK_FORGE_TOKEN, ANDROID_HOME, JAVA_HOME
// ──────────────────────────────────────────────────────────────────────────
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

const SERVER = String(opt('server') || process.env.APK_FORGE_SERVER || '').replace(/\/$/, '');
const TOKEN = opt('token') || process.env.APK_FORGE_TOKEN;
const WORK = opt('workdir') || path.join(os.tmpdir(), 'apk-forge');
const KEEP = !!opt('keep');
const IS_WIN = process.platform === 'win32';

if (!SERVER || !TOKEN || SERVER === 'true') {
  console.error('Usage: node apk-agent.mjs --server <forge url> --token <agent token>');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const osInfo = () => `${os.platform()} ${os.release()} · ${os.arch()} · node ${process.version}`;
const fmt = (n) => (n > 1048576 ? (n / 1048576).toFixed(2) + ' MB' : (n / 1024).toFixed(1) + ' KB');

async function call(action, payload = {}) {
  const r = await fetch(`${SERVER}/api/agent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-token': TOKEN },
    body: JSON.stringify({ action, ...payload }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

class RemoteLog {
  constructor(id) {
    this.id = id;
    this.buf = '';
    this.status = 'running';
    this.timer = setInterval(() => this.flush(), 2000);
  }
  write(s) { process.stdout.write(s); this.buf += s; }
  line(s) { this.write(s + '\n'); }
  async flush() {
    if (!this.buf) {
      try { const r = await call('log', { build_id: this.id, chunk: '' }); this.status = r.status; } catch {}
      return;
    }
    const chunk = this.buf; this.buf = '';
    try { const r = await call('log', { build_id: this.id, chunk }); this.status = r.status; }
    catch { this.buf = chunk + this.buf; }
  }
  async close() { clearInterval(this.timer); await this.flush(); }
}

function run(cmd, args, opts, log, isCancelled = () => false) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (code) => { if (!done) { done = true; clearInterval(iv); resolve(code); } };
    log.line(`$ ${cmd} ${args.join(' ')}`);
    const { yes, ...spawnOpts } = opts || {};
    const child = spawn(cmd, args, { ...spawnOpts, shell: IS_WIN });
    if (yes && child.stdin) { child.stdin.on('error', () => {}); child.stdin.write('y\n'.repeat(40)); child.stdin.end(); }
    child.stdout?.on('data', (d) => log.write(d.toString()));
    child.stderr?.on('data', (d) => log.write(d.toString()));
    const iv = setInterval(() => {
      if (isCancelled()) { log.line('[agent] cancel requested — stopping process'); child.kill('SIGTERM'); }
    }, 1000);
    child.on('error', (e) => { log.line(`[agent] failed to start ${cmd}: ${e.message}`); finish(127); });
    child.on('close', (code) => finish(code ?? 1));
  });
}

async function walk(dir, depth, out = []) {
  if (depth < 0) return out;
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['.git', 'node_modules', '__MACOSX'].includes(e.name)) await walk(p, depth - 1, out); }
    else out.push(p);
  }
  return out;
}

async function findRoot(dir) {
  const files = await walk(dir, 4);
  const markers = files.filter((f) => /(^|[\\/])(settings\.gradle(\.kts)?|gradlew)$/.test(f));
  if (!markers.length) return null;
  markers.sort((a, b) => a.split(path.sep).length - b.split(path.sep).length);
  return path.dirname(markers[0]);
}

async function extract(zip, dest, log) {
  if (IS_WIN) {
    return run('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -Path "${zip}" -DestinationPath "${dest}"`], {}, log);
  }
  let code = await run('unzip', ['-q', '-o', zip, '-d', dest], {}, log);
  if (code !== 0) code = await run('python3', ['-m', 'zipfile', '-e', zip, dest], {}, log);
  if (code !== 0) code = await run('tar', ['-xf', zip, '-C', dest], {}, log);
  return code;
}

// ── Managed toolchain provisioning ─────────────────────────────────────────
const TOOLS = path.join(os.homedir(), '.apk-forge', 'tools');
const PLAT = IS_WIN ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
const ARCH = process.arch === 'arm64' ? 'aarch64' : 'x64';
const CMDLINE_TOOLS = '11076708';

async function fetchTo(url, dest, log) {
  log.line(`[agent] ↓ ${url}`);
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok || !r.body) throw new Error(`Download failed (${r.status}): ${url}`);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(dest));
  log.line(`[agent]   saved ${fmt((await fsp.stat(dest)).size)}`);
}

async function findDirWith(dir, rel, depth = 4) {
  if (fs.existsSync(path.join(dir, rel))) return dir;
  if (depth <= 0) return null;
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) if (e.isDirectory()) { const f = await findDirWith(path.join(dir, e.name), rel, depth - 1); if (f) return f; }
  return null;
}

async function ensureJdk(version, log) {
  const major = String(version).split('.')[0];
  const dir = path.join(TOOLS, `jdk-${major}`);
  const javaBin = path.join('bin', IS_WIN ? 'java.exe' : 'java');
  let home = await findDirWith(dir, javaBin);
  if (home) { log.line(`[agent] JDK ${major} ready (managed)`); return home; }
  log.line(`[agent] Installing JDK ${major} (Temurin) automatically…`);
  const archive = path.join(TOOLS, `jdk-${major}.${IS_WIN ? 'zip' : 'tar.gz'}`);
  await fetchTo(`https://api.adoptium.net/v3/binary/latest/${major}/ga/${PLAT}/${ARCH}/jdk/hotspot/normal/eclipse`, archive, log);
  await fsp.mkdir(dir, { recursive: true });
  const code = IS_WIN ? await extract(archive, dir, log) : await run('tar', ['-xzf', archive, '-C', dir], {}, log);
  await fsp.rm(archive, { force: true });
  if (code !== 0) throw new Error(`Could not extract JDK ${major}`);
  home = await findDirWith(dir, javaBin);
  if (!home) throw new Error(`JDK ${major} installed but java binary not found`);
  log.line(`[agent] ✔ JDK ${major} installed`);
  return home;
}

async function ensureSdk(sdk, platform, buildTools, log, cancelled) {
  await fsp.mkdir(path.join(sdk, 'licenses'), { recursive: true });
  const lic = path.join(sdk, 'licenses', 'android-sdk-license');
  if (!fs.existsSync(lic)) {
    await fsp.writeFile(lic, '\n24333f8a63b6825ea9c5514f83c2829b004d1fee\n\nd56f5187479451eabf01fb78af6dfcb131a6481e\n');
    log.line('[agent] Accepted Android SDK licenses');
  }
  let sdkm = path.join(sdk, 'cmdline-tools', 'latest', 'bin', IS_WIN ? 'sdkmanager.bat' : 'sdkmanager');
  if (!fs.existsSync(sdkm)) {
    log.line('[agent] Installing Android command-line tools automatically…');
    const z = path.join(TOOLS, 'cmdline-tools.zip');
    await fetchTo(`https://dl.google.com/android/repository/commandlinetools-${PLAT === 'windows' ? 'win' : PLAT}-${CMDLINE_TOOLS}_latest.zip`, z, log);
    const tmp = path.join(TOOLS, 'cmdline-tmp');
    await fsp.rm(tmp, { recursive: true, force: true });
    await fsp.mkdir(tmp, { recursive: true });
    if ((await extract(z, tmp, log)) !== 0) throw new Error('Could not extract Android command-line tools');
    await fsp.mkdir(path.join(sdk, 'cmdline-tools'), { recursive: true });
    await fsp.rm(path.join(sdk, 'cmdline-tools', 'latest'), { recursive: true, force: true });
    await fsp.rename(path.join(tmp, 'cmdline-tools'), path.join(sdk, 'cmdline-tools', 'latest'));
    await fsp.rm(z, { force: true }); await fsp.rm(tmp, { recursive: true, force: true });
    if (!IS_WIN) await run('chmod', ['-R', '+x', path.join(sdk, 'cmdline-tools', 'latest', 'bin')], {}, log);
  }
  const pkgs = [];
  if (!fs.existsSync(path.join(sdk, 'platform-tools'))) pkgs.push('platform-tools');
  if (platform && !fs.existsSync(path.join(sdk, 'platforms', `android-${platform}`))) pkgs.push(`platforms;android-${platform}`);
  if (buildTools && !fs.existsSync(path.join(sdk, 'build-tools', buildTools))) pkgs.push(`build-tools;${buildTools}`);
  if (!pkgs.length) { log.line('[agent] Android SDK packages ready'); return; }
  log.line(`[agent] Installing SDK packages: ${pkgs.join(', ')}`);
  const jdk = await ensureJdk('17', log);
  const env = { ...process.env, JAVA_HOME: jdk, PATH: path.join(jdk, 'bin') + path.delimiter + process.env.PATH };
  const code = await run(sdkm, [`--sdk_root=${sdk}`, ...pkgs], { env, yes: true }, log, cancelled);
  if (code !== 0) log.line('[agent] ⚠ sdkmanager reported an error — Gradle will try to fetch missing parts itself');
}

async function ensureGradle(version, log) {
  const dir = path.join(TOOLS, `gradle-${version}`);
  const bin = path.join('bin', IS_WIN ? 'gradle.bat' : 'gradle');
  let home = await findDirWith(dir, bin, 2);
  if (home) return home;
  log.line(`[agent] Installing Gradle ${version} automatically…`);
  const z = path.join(TOOLS, `gradle-${version}.zip`);
  await fetchTo(`https://services.gradle.org/distributions/gradle-${version}-bin.zip`, z, log);
  await fsp.mkdir(dir, { recursive: true });
  if ((await extract(z, dir, log)) !== 0) throw new Error(`Could not extract Gradle ${version}`);
  await fsp.rm(z, { force: true });
  home = await findDirWith(dir, bin, 2);
  if (!home) throw new Error(`Gradle ${version} installed but binary not found`);
  return home;
}

let busy = false;

async function runBuild(b) {
  busy = true;
  const log = new RemoteLog(b.id);
  const cancelled = () => log.status === 'cancelled';
  const dir = path.join(WORK, `build-${b.id}`);
  const started = Date.now();
  try {
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.mkdir(dir, { recursive: true });
    log.line(`[agent] ▶ Build #${b.id} · ${b.project?.name ?? 'project'}`);
    log.line(`[agent] task=${b.gradle_task} type=${b.build_type} jdk=${b.jdk_version} sdk=${b.sdk_platform ?? '-'} build-tools=${b.build_tools ?? '-'} gradle=${b.gradle_version ?? 'wrapper'}`);

    log.line('[agent] Downloading source zip…');
    const r = await fetch(b.project.zip_url);
    if (!r.ok) throw new Error(`Download failed: HTTP ${r.status}`);
    const zipBuf = Buffer.from(await r.arrayBuffer());
    const zipPath = path.join(dir, 'source.zip');
    await fsp.writeFile(zipPath, zipBuf);
    log.line(`[agent] Downloaded ${fmt(zipBuf.length)}`);

    const src = path.join(dir, 'src');
    await fsp.mkdir(src, { recursive: true });
    if ((await extract(zipPath, src, log)) !== 0) throw new Error('Could not extract zip (install unzip, python3 or tar)');
    const root = await findRoot(src);
    if (!root) throw new Error('No settings.gradle / gradlew found — is this an Android Gradle project?');
    log.line(`[agent] Project root: ${path.relative(src, root) || '.'}`);

    const env = { ...process.env };
    // ── Fully managed toolchain: auto-install JDK / Android SDK / Gradle if missing ──
    const jdkHome = (b.paths?.jdk && fs.existsSync(b.paths.jdk)) ? b.paths.jdk : await ensureJdk(b.jdk_version || '17', log);
    env.JAVA_HOME = jdkHome;
    env.PATH = path.join(jdkHome, 'bin') + path.delimiter + env.PATH;
    log.line(`[agent] JAVA_HOME=${jdkHome}`);

    const sdk = (b.paths?.sdk && fs.existsSync(b.paths.sdk) ? b.paths.sdk : null) || env.ANDROID_HOME || env.ANDROID_SDK_ROOT || path.join(TOOLS, 'android-sdk');
    await ensureSdk(sdk, b.sdk_platform, b.build_tools, log, cancelled);
    env.ANDROID_HOME = sdk; env.ANDROID_SDK_ROOT = sdk;
    const escaped = IS_WIN ? sdk.replace(/\\/g, '\\\\').replace(/:/g, '\\:') : sdk;
    await fsp.writeFile(path.join(root, 'local.properties'), `sdk.dir=${escaped}\n`);
    log.line(`[agent] ANDROID_HOME=${sdk}`);

    const wrapper = path.join(root, IS_WIN ? 'gradlew.bat' : 'gradlew');
    let gradleCmd;
    if (fs.existsSync(wrapper)) {
      if (!IS_WIN) await fsp.chmod(wrapper, 0o755);
      gradleCmd = wrapper;
      log.line('[agent] Using project Gradle wrapper (downloads its own Gradle automatically)');
    } else {
      const gHome = (b.paths?.gradle && fs.existsSync(b.paths.gradle)) ? b.paths.gradle : await ensureGradle(b.gradle_version || '8.11.1', log);
      gradleCmd = path.join(gHome, 'bin', IS_WIN ? 'gradle.bat' : 'gradle');
      if (!IS_WIN) await fsp.chmod(gradleCmd, 0o755).catch(() => {});
      log.line(`[agent] No wrapper — using managed Gradle at ${gHome}`);
    }

    const extra = (b.extra_args || '').split(/\s+/).filter(Boolean);
    const code = await run(gradleCmd, [b.gradle_task, '--no-daemon', '--stacktrace', ...extra], { cwd: root, env }, log, cancelled);
    await log.flush();
    if (cancelled()) { log.line('[agent] Build cancelled.'); await log.close(); await call('complete', { build_id: b.id, status: 'cancelled' }); return; }
    if (code !== 0) throw new Error(`Gradle exited with code ${code}`);

    const outputs = (await walk(root, 12)).filter((f) => f.endsWith('.apk') && f.includes(`${path.sep}outputs${path.sep}apk`));
    if (!outputs.length) throw new Error('Gradle succeeded but no APK was found in */build/outputs/apk');
    const stats = await Promise.all(outputs.map(async (f) => ({ f, t: (await fsp.stat(f)).mtimeMs })));
    stats.sort((a, b2) => b2.t - a.t);
    const apk = stats[0].f;
    const data = await fsp.readFile(apk);
    log.line(`[agent] APK: ${path.relative(root, apk)} (${fmt(data.length)})`);

    log.line('[agent] Uploading APK…');
    const up = await call('upload-url', { build_id: b.id, file_name: path.basename(apk) });
    const put = await fetch(up.signedUrl, {
      method: 'PUT',
      headers: { 'content-type': 'application/vnd.android.package-archive', 'x-upsert': 'true' },
      body: data,
    });
    if (!put.ok) throw new Error(`APK upload failed: HTTP ${put.status} ${(await put.text()).slice(0, 200)}`);
    log.line(`[agent] ✔ BUILD SUCCESSFUL in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    await log.close();
    await call('complete', { build_id: b.id, status: 'success', apk_path: up.path, apk_size: data.length });
  } catch (e) {
    log.line(`[agent] ✖ ${e.message}`);
    await log.close();
    await call('complete', { build_id: b.id, status: cancelled() ? 'cancelled' : 'failed', error: e.message }).catch(() => {});
  } finally {
    busy = false;
    if (!KEEP) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  await fsp.mkdir(WORK, { recursive: true });
  const hello = await call('heartbeat', { os: osInfo() });
  console.log(`\n  ▲ APK Forge agent "${hello.name}" connected to ${SERVER}`);
  console.log(`    workdir: ${WORK}\n    waiting for builds…\n`);
  setInterval(() => call('heartbeat', { os: osInfo(), busy }).catch((e) => console.error('[agent] heartbeat failed:', e.message)), 15000);
  for (;;) {
    if (!busy) {
      try {
        const { build } = await call('claim', { os: osInfo() });
        if (build) { await runBuild(build); continue; }
      } catch (e) { console.error('[agent] claim failed:', e.message); }
    }
    await sleep(5000);
  }
}

main().catch((e) => { console.error('[agent] fatal:', e.message); process.exit(1); });
