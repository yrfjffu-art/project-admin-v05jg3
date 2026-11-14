import { z, id, idStr, version, optVersion, gradleTask, extraArgs, moduleName } from './validate.js';

const emptyToUndef = (s) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), s);
const urlField = (max = 2048) => emptyToUndef(z.string().trim().max(max).optional());

/** Body shared by web UI, Telegram and the public API (POST /api/v1/build). */
export const websiteBuildBody = z.object({
  url: z.string().trim().min(4, 'url is required').max(2048),
  app_name: emptyToUndef(z.string().trim().max(80).optional()),
  package_name: emptyToUndef(z.string().trim().max(150).optional()),
  icon_url: urlField(),
  webhook_url: urlField(),
}).strict();

const optStr = (max) => z.string().max(max).nullish();
const analysis = z.record(z.any()).nullish().refine((v) => !v || JSON.stringify(v).length < 50_000, 'analysis is too large');

// Schemas for the pre-existing dashboard routes (now validated before the handler runs).
export const legacy = {
  projects: {
    GET: { query: z.object({ id: idStr.optional() }).strict() },
    POST: { body: z.object({ name: z.string().trim().min(1).max(100), package_name: optStr(150), description: optStr(2000), zip_path: z.string().max(300), zip_name: optStr(200), zip_size: z.number().int().min(0).max(60 * 1024 * 1024).nullish(), analysis }).strict() },
    PUT: { body: z.object({ id, name: z.string().trim().min(1).max(100).optional(), package_name: optStr(150), description: optStr(2000), zip_path: z.string().max(300).optional(), zip_name: optStr(200), zip_size: z.number().int().min(0).max(60 * 1024 * 1024).nullish(), analysis }).strict() },
    DELETE: { body: z.object({ id }).strict() },
    OPTIONS: null,
  },
  upload: {
    POST: { body: z.object({ fileName: z.string().min(5).max(200).regex(/\.zip$/i, 'A .zip file is required') }).strict() },
    OPTIONS: null,
  },
  builds: {
    GET: { query: z.object({ id: idStr.optional(), project_id: idStr.optional(), status: z.enum(['queued', 'running', 'success', 'failed', 'cancelled']).optional(), limit: idStr.optional() }).strict() },
    POST: { body: z.object({ project_id: id, runner: z.enum(['cloud', 'agent']).optional(), build_type: z.enum(['debug', 'release']).optional(), module: moduleName, gradle_task: gradleTask, jdk_version: version.min(1, 'Select a JDK version'), sdk_platform: optVersion, build_tools: optVersion, gradle_version: optVersion, extra_args: extraArgs }).strict() },
    PUT: { body: z.object({ id, action: z.enum(['cancel']) }).strict() },
    DELETE: { body: z.object({ id }).strict() },
    OPTIONS: null,
  },
  toolchains: {
    GET: null,
    POST: { body: z.object({ kind: z.enum(['jdk', 'android-sdk', 'build-tools', 'gradle', 'ndk']), version: version.min(1), label: optStr(100), path: optStr(300), notes: optStr(500) }).strict() },
    PUT: { body: z.object({ id, label: optStr(100), path: optStr(300), notes: optStr(500), enabled: z.boolean().optional(), version: version.optional(), is_default: z.boolean().optional() }).strict() },
    DELETE: { body: z.object({ id }).strict() },
    OPTIONS: null,
  },
  agents: {
    GET: null,
    POST: { body: z.object({ name: z.string().trim().min(1).max(60) }).strict() },
    PUT: { body: z.object({ id, name: z.string().trim().max(60).optional(), rotate: z.boolean().optional() }).strict() },
    DELETE: { body: z.object({ id }).strict() },
    OPTIONS: null,
  },
  agent: {
    POST: { body: z.object({ action: z.enum(['heartbeat', 'claim', 'log', 'upload-url', 'complete']), build_id: id.optional(), chunk: z.string().max(200_000).optional(), os: z.string().max(200).optional(), busy: z.boolean().optional(), status: z.enum(['success', 'failed', 'cancelled']).optional(), apk_path: z.string().max(300).optional(), apk_size: z.number().int().min(0).max(500 * 1024 * 1024).optional(), error: z.string().max(2000).optional(), file_name: z.string().max(200).optional() }).strict() },
    OPTIONS: null,
  },
  cloud: {
    GET: null,
    POST: { body: z.object({ action: z.enum(['connect', 'disconnect', 'sync']), token: z.string().trim().max(255).optional(), build_id: id.optional() }).strict() },
    OPTIONS: null,
  },
};

export const githubCallback = z.object({
  build_id: id,
  ts: z.number().int(),
  payload: z.string().max(400_000).regex(/^[A-Za-z0-9+/=]*$/, 'payload must be base64'),
  sig: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const githubCallbackPayload = z.object({
  event: z.enum(['started', 'upload-url', 'finished', 'cancelled']),
  run_id: z.string().regex(/^\d{1,20}$/).optional(),
  run_url: z.string().url().max(300).optional(),
  apk_name: z.string().max(200).optional(),
  status: z.enum(['success', 'failed']).optional(),
  apk_path: z.string().max(300).optional(),
  apk_size: z.number().int().min(0).max(500 * 1024 * 1024).optional(),
  failed_step: z.string().max(100).optional(),
  error_lines: z.string().max(40_000).optional(),
  what_went_wrong: z.string().max(20_000).optional(),
  log_tail: z.string().max(80_000).optional(),
}).strict();
