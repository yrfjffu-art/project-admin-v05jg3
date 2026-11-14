// Self-contained admin UI. Served only at /api/<ADMIN_PATH>; it is not part of the public
// SPA bundle, so nothing in the frontend reveals the path. Inline script/style use a CSP nonce.
export function adminPage(nonce) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Console</title>
<style nonce="${nonce}">
:root{--bg:#0b0d10;--panel:#12161b;--line:#232a33;--ink:#e7ecf2;--mute:#8793a2;--acc:#ffb547;--ok:#3ddc84;--bad:#ff6161}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
header{display:flex;align-items:center;gap:16px;padding:14px 20px;border-bottom:1px solid var(--line);background:var(--panel);position:sticky;top:0}
header b{color:var(--acc);letter-spacing:.12em}nav{display:flex;gap:4px;flex-wrap:wrap}nav button{background:none;border:0;color:var(--mute);padding:6px 10px;border-radius:6px;cursor:pointer;font:inherit}
nav button.on,nav button:hover{background:#1b2129;color:var(--ink)}main{padding:20px;max-width:1200px;margin:0 auto}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;margin-bottom:16px}
input,select,textarea{background:#0e1216;border:1px solid var(--line);color:var(--ink);border-radius:7px;padding:8px 10px;font:inherit;width:100%}
button.b{background:var(--acc);color:#1a1205;border:0;border-radius:7px;padding:8px 14px;font:inherit;font-weight:700;cursor:pointer}
button.g{background:#1b2129;color:var(--ink);border:1px solid var(--line);border-radius:7px;padding:5px 10px;font:inherit;cursor:pointer}
button.r{background:none;color:var(--bad);border:1px solid #5a2a2a;border-radius:7px;padding:5px 10px;font:inherit;cursor:pointer}
table{width:100%;border-collapse:collapse;font-size:12.5px}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mute);font-weight:500}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}.k{color:var(--mute);font-size:11px;text-transform:uppercase;letter-spacing:.1em}.v{font-size:26px;font-weight:700}
.err{color:var(--bad);margin-top:8px}.ok{color:var(--ok)}.muted{color:var(--mute)}pre{white-space:pre-wrap;word-break:break-all;background:#07090b;border:1px solid var(--line);border-radius:8px;padding:12px;max-height:60vh;overflow:auto;font-size:12px}
#login{max-width:360px;margin:12vh auto}label{display:block;margin:10px 0 4px;color:var(--mute);font-size:12px}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.hide{display:none}
</style></head><body>
<div id="login" class="card"><h2>Sign in</h2>
<label>Email</label><input id="em" type="email" autocomplete="username">
<label>Password</label><input id="pw" type="password" autocomplete="current-password">
<div id="totpRow" class="hide"><label>Authenticator code</label><input id="tp" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
<div style="margin-top:14px"><button class="b" id="go">Sign in</button></div><div id="lerr" class="err"></div></div>
<div id="app" class="hide"><header><b>CONSOLE</b><nav id="nav"></nav><span style="flex:1"></span><span id="who" class="muted"></span><button class="g" id="out">Sign out</button></header><main id="view"></main></div>
<script nonce="${nonce}">
(() => {
const BASE = location.pathname.replace(/\\/$/, '');
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const csrf = () => (document.cookie.split('; ').find((c) => c.startsWith('__Host-w2a_csrf=')) || '').split('=')[1] || '';
async function api(path, opts = {}, retried) {
  const r = await fetch(BASE + path, { method: opts.method || 'GET', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (r.status === 404 && !retried && path !== '/refresh' && path !== '/login') {
    const rr = await fetch(BASE + '/refresh', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf() } });
    if (rr.ok) return api(path, opts, true);
    showLogin(); throw new Error('Session expired');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || ('HTTP ' + r.status)); e.data = j; throw e; }
  return j;
}
function showLogin() { $('#app').classList.add('hide'); $('#login').classList.remove('hide'); }
async function login() {
  $('#lerr').textContent = '';
  try {
    const body = { email: $('#em').value, password: $('#pw').value };
    if ($('#tp').value) body.totp = $('#tp').value;
    await api('/login', { method: 'POST', body });
    $('#pw').value = ''; $('#tp').value = '';
    boot();
  } catch (e) {
    if (e.data && e.data.totp_required) $('#totpRow').classList.remove('hide');
    $('#lerr').textContent = e.message;
  }
}
$('#go').addEventListener('click', login);
$('#pw').addEventListener('keydown', (e) => e.key === 'Enter' && login());
$('#tp').addEventListener('keydown', (e) => e.key === 'Enter' && login());
$('#out').addEventListener('click', async () => { await api('/logout', { method: 'POST' }).catch(() => {}); showLogin(); });

const TABS = { Stats: stats, Users: users, Builds: builds, 'API keys': keys, Bots: bots, Settings: settings, Audit: audit, Security: security };
let current = 'Stats';
function nav() {
  $('#nav').innerHTML = Object.keys(TABS).map((t) => '<button data-t="' + esc(t) + '" class="' + (t === current ? 'on' : '') + '">' + esc(t) + '</button>').join('');
  $('#nav').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { current = b.dataset.t; render(); }));
}
async function render() { nav(); $('#view').innerHTML = '<p class="muted">Loading…</p>'; try { await TABS[current]($('#view')); } catch (e) { $('#view').innerHTML = '<p class="err">' + esc(e.message) + '</p>'; } }
function bind(root, sel, fn) { root.querySelectorAll(sel).forEach((el) => el.addEventListener('click', () => fn(el.dataset.id, el))); }
async function act(fn, msg) { try { await fn(); render(); } catch (e) { alert(e.message); } }

async function stats(v) {
  const s = await api('/stats');
  const cell = (k, x) => '<div class="card"><div class="k">' + esc(k) + '</div><div class="v">' + esc(x ?? '—') + '</div></div>';
  v.innerHTML = '<div class="grid">' + cell('Users', s.users) + cell('Builds total', s.builds.total) + cell('Builds 24h', s.builds.last24) + cell('Active', s.builds.active) + cell('Success rate', s.success_rate == null ? '—' : s.success_rate + '%') + cell('Failed', s.builds.failed) + cell('API keys', s.api_keys_active) + cell('Telegram bots', s.telegram_bots) + '</div>'
    + '<div class="card"><div class="k">Builds by source</div><pre>' + esc(JSON.stringify(s.by_source, null, 2)) + '</pre></div>';
}
async function users(v) {
  const d = await api('/users');
  v.innerHTML = '<div class="card"><table><tr><th>Email</th><th>Created</th><th>Last sign-in</th><th>Status</th><th></th></tr>' + d.users.map((u) => {
    const banned = u.banned_until && new Date(u.banned_until) > new Date();
    return '<tr><td>' + esc(u.email) + '<div class="muted">' + esc(u.id) + '</div></td><td>' + esc((u.created_at || '').slice(0, 10)) + '</td><td>' + esc((u.last_sign_in_at || '').slice(0, 16)) + '</td><td>' + (banned ? '<span class="err">banned</span>' : '<span class="ok">active</span>') + '</td><td>' + (banned ? '<button class="g" data-act="unban" data-id="' + esc(u.id) + '">Unban</button>' : '<button class="r" data-act="ban" data-id="' + esc(u.id) + '">Ban</button>') + '</td></tr>';
  }).join('') + '</table></div>';
  bind(v, '[data-act=ban]', (id) => { const reason = prompt('Reason for ban (logged):'); if (reason !== null) act(() => api('/users/' + id + '/ban', { method: 'POST', body: { reason } })); });
  bind(v, '[data-act=unban]', (id) => act(() => api('/users/' + id + '/unban', { method: 'POST' })));
}
async function builds(v) {
  const list = await api('/builds');
  v.innerHTML = '<div class="card"><table><tr><th>#</th><th>Project</th><th>Source</th><th>Status</th><th>Created</th><th></th></tr>' + list.map((b) => '<tr><td>' + b.id + '</td><td>' + esc(b.projects?.name) + '<div class="muted">' + esc(b.meta?.site_url || b.projects?.package_name || '') + '</div></td><td>' + esc(b.meta?.source || '—') + '</td><td class="' + (b.status === 'success' ? 'ok' : b.status === 'failed' ? 'err' : '') + '">' + esc(b.status) + '</td><td>' + esc((b.created_at || '').slice(0, 16)) + '</td><td><button class="g" data-id="' + b.id + '">Logs</button></td></tr>').join('') + '</table></div><div id="logbox"></div>';
  bind(v, 'button[data-id]', async (id) => { const b = await api('/builds/' + id); $('#logbox').innerHTML = '<div class="card"><b>Build #' + b.id + '</b> <span class="muted">' + esc(b.error || '') + '</span><pre>' + esc(b.logs || '') + '</pre></div>'; $('#logbox').scrollIntoView(); });
}
async function keys(v) {
  const list = await api('/api-keys');
  v.innerHTML = '<div class="card"><table><tr><th>Name</th><th>Prefix</th><th>Owner</th><th>Limits</th><th>Last used</th><th></th></tr>' + list.map((k) => '<tr><td>' + esc(k.name) + '</td><td>' + esc(k.prefix) + '…</td><td class="muted">' + esc(k.user_id) + '</td><td>' + k.rate_per_hour + '/h · ' + k.monthly_quota + '/mo</td><td>' + esc((k.last_used_at || 'never').slice(0, 16)) + '</td><td>' + (k.revoked_at ? '<span class="muted">revoked</span>' : '<button class="r" data-id="' + k.id + '">Revoke</button>') + '</td></tr>').join('') + '</table></div>';
  bind(v, 'button[data-id]', (id) => confirm('Revoke this API key?') && act(() => api('/api-keys/' + id + '/revoke', { method: 'POST' })));
}
async function bots(v) {
  const list = await api('/bots');
  v.innerHTML = '<div class="card"><table><tr><th>Bot</th><th>Owner</th><th>Access</th><th>Webhook</th><th>Last update</th><th></th></tr>' + list.map((b) => '<tr><td>@' + esc(b.bot_username) + '</td><td class="muted">' + esc(b.user_id) + '</td><td>' + (b.allow_public ? 'public' : 'owner only') + '</td><td>' + (b.webhook_ok ? '<span class="ok">ok</span>' : '<span class="err">off</span>') + '</td><td>' + esc((b.last_update_at || '—').slice(0, 16)) + '</td><td>' + (b.disabled_by_admin ? '<button class="g" data-act="en" data-id="' + b.id + '">Enable</button>' : '<button class="r" data-act="dis" data-id="' + b.id + '">Disable</button>') + '</td></tr>').join('') + '</table></div>';
  bind(v, '[data-act=dis]', (id) => confirm('Disable this bot and remove its webhook?') && act(() => api('/bots/' + id + '/disable', { method: 'POST' })));
  bind(v, '[data-act=en]', (id) => act(() => api('/bots/' + id + '/enable', { method: 'POST' })));
}
async function settings(v) {
  const s = await api('/settings');
  const f = (k, label) => '<label>' + esc(label) + '</label><input data-k="' + k + '" type="number" min="0" value="' + esc(s[k]) + '">';
  v.innerHTML = '<div class="card"><label class="row"><input id="be" type="checkbox" style="width:auto" ' + (s.builds_enabled ? 'checked' : '') + '> Builds enabled (turn off for maintenance)</label>' + f('default_rate_per_hour', 'Default API builds per hour (new keys)') + f('default_monthly_quota', 'Default API monthly quota (new keys)') + f('web_builds_per_hour', 'Web builds per user per hour') + f('telegram_builds_per_hour', 'Telegram builds per chat per hour') + f('max_active_api_keys', 'Max active API keys per user') + f('max_telegram_bots', 'Max Telegram bots per user') + '<div style="margin-top:14px"><button class="b" id="save">Save settings</button> <span id="sm" class="ok"></span></div></div>';
  $('#save').addEventListener('click', async () => {
    const body = { builds_enabled: $('#be').checked };
    v.querySelectorAll('input[data-k]').forEach((i) => body[i.dataset.k] = Number(i.value));
    try { await api('/settings', { method: 'PUT', body }); $('#sm').textContent = 'Saved'; } catch (e) { alert(e.message); }
  });
}
async function audit(v) {
  const list = await api('/audit');
  v.innerHTML = '<div class="card"><table><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>IP</th><th>Details</th></tr>' + list.map((a) => '<tr><td>' + esc((a.created_at || '').slice(0, 19).replace('T', ' ')) + '</td><td>' + esc(a.admin_email) + '</td><td>' + esc(a.action) + '</td><td>' + esc(a.target) + '</td><td>' + esc(a.ip) + '</td><td class="muted">' + esc(a.details ? JSON.stringify(a.details) : '') + '</td></tr>').join('') + '</table></div>';
}
async function security(v) {
  const me = await api('/me');
  v.innerHTML = '<div class="card"><b>Two-factor authentication</b><p class="muted">Status: ' + (me.totp_enabled ? '<span class="ok">enabled</span>' : '<span class="err">disabled</span>') + '</p><div id="tf"></div></div>'
    + '<div class="card"><b>Change password</b><label>Current</label><input id="pc" type="password"><label>New (14+ chars, mixed classes)</label><input id="pn" type="password"><div style="margin-top:10px"><button class="b" id="pwb">Change password</button></div></div>'
    + '<div class="card"><b>Sessions</b><p class="muted">Sign out everywhere (including this browser).</p><button class="r" id="rall">Revoke all sessions</button></div>';
  const tf = $('#tf');
  if (!me.totp_enabled) {
    tf.innerHTML = '<button class="b" id="ts">Set up authenticator</button>';
    $('#ts').addEventListener('click', async () => {
      const s = await api('/totp/setup', { method: 'POST' });
      tf.innerHTML = '<p>Add this secret to your authenticator app (manual entry, TOTP/SHA-1/6 digits/30s):</p><pre>' + esc(s.secret) + '</pre><p class="muted">or otpauth URI:</p><pre>' + esc(s.otpauth) + '</pre><label>Enter the 6-digit code to confirm</label><input id="tc" inputmode="numeric" maxlength="6"><div style="margin-top:10px"><button class="b" id="te">Enable 2FA</button></div>';
      $('#te').addEventListener('click', () => act(() => api('/totp/enable', { method: 'POST', body: { code: $('#tc').value } })));
    });
  } else {
    tf.innerHTML = '<label>Password</label><input id="dp" type="password"><label>Current code</label><input id="dc" inputmode="numeric" maxlength="6"><div style="margin-top:10px"><button class="r" id="td">Disable 2FA</button></div>';
    $('#td').addEventListener('click', () => act(() => api('/totp/disable', { method: 'POST', body: { password: $('#dp').value, code: $('#dc').value } })));
  }
  $('#pwb').addEventListener('click', () => act(async () => { await api('/password', { method: 'POST', body: { current: $('#pc').value, next: $('#pn').value } }); alert('Password changed. Other sessions were signed out.'); }));
  $('#rall').addEventListener('click', async () => { if (confirm('Sign out all sessions?')) { await api('/sessions/revoke-all', { method: 'POST' }); showLogin(); } });
}
async function boot() {
  try { const me = await api('/me'); $('#who').textContent = me.email; $('#login').classList.add('hide'); $('#app').classList.remove('hide'); render(); }
  catch { showLogin(); }
}
boot();
})();
</script></body></html>`;
}
