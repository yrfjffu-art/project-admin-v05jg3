import { readSecret, writeSecret } from './vault.js';

// System settings live in the private vault so they can't be changed through the public API key.
export const DEFAULT_SETTINGS = {
  builds_enabled: true,
  default_rate_per_hour: 10,
  default_monthly_quota: 200,
  web_builds_per_hour: 20,
  telegram_builds_per_hour: 5,
  max_active_api_keys: 10,
  max_telegram_bots: 3,
};

let cached = null;
let cachedAt = 0;

export async function getSettings() {
  if (cached && Date.now() - cachedAt < 30_000) return cached;
  const stored = (await readSecret('settings/system.json')) || {};
  cached = { ...DEFAULT_SETTINGS, ...stored };
  cachedAt = Date.now();
  return cached;
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await writeSecret('settings/system.json', next);
  cached = next;
  cachedAt = Date.now();
  return next;
}
