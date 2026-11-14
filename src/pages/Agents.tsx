import { useEffect, useState } from 'react';
import { Plus, Server, Trash2, Copy, Check, RefreshCw, Eye, EyeOff, Loader2, Terminal, Cloud, Github, ExternalLink } from 'lucide-react';
import { api } from '../lib/api';
import type { Agent, CloudConn } from '../lib/types';
import { PageHeader, Spinner, ErrorBox, Empty } from '../components/ui';
import { timeAgo } from '../lib/format';

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }} className="text-mute hover:text-droid" aria-label="Copy">
      {ok ? <Check className="h-4 w-4 text-droid" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

function CloudCard() {
  const [conn, setConn] = useState<CloudConn | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = () => api<CloudConn>('/api/cloud').then(setConn).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const connect = async () => {
    setErr('');
    if (!/^(ghp_|github_pat_|gho_)/.test(token.trim())) return setErr('That does not look like a GitHub token (starts with ghp_ or github_pat_).');
    setBusy(true);
    try { setConn(await api<CloudConn>('/api/cloud', { method: 'POST', body: { action: 'connect', token } })); setToken(''); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const disconnect = async () => {
    if (!confirm('Disconnect GitHub cloud builds?')) return;
    setConn(await api<CloudConn>('/api/cloud', { method: 'POST', body: { action: 'disconnect' } }));
  };
  return (
    <div className={`card mb-8 p-5 ${conn?.connected ? 'border-droid/50' : 'border-amber/50'}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-droid/10 text-droid"><Cloud className="h-5 w-5" /></div>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2 font-display text-lg font-semibold">Cloud builder <span className="chip">recommended · no PC needed</span></div>
          <p className="mt-1 text-sm text-mute">APKs build on GitHub's free servers. JDK, Android SDK, build-tools &amp; Gradle are installed automatically every build. Uses a private repo <span className="font-mono text-ink">apk-forge-builds</span> in your account.</p>
          {conn === null ? <div className="mt-3"><Spinner /></div> : conn.connected ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-md border border-droid/40 bg-droid/10 px-3 py-1.5 font-mono text-sm text-droid"><Github className="h-4 w-4" /> {conn.repo}</span>
              <span className="text-sm text-droid">Connected — just upload a zip and press Build.</span>
              <button onClick={disconnect} className="text-xs text-mute hover:text-danger">Disconnect</button>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <ol className="space-y-1 text-sm text-mute">
                <li><span className="font-mono text-droid">1.</span> Sign in / sign up free at GitHub, then open{' '}
                  <a className="inline-flex items-center gap-1 text-droid underline" target="_blank" rel="noreferrer" href="https://github.com/settings/tokens/new?scopes=repo,workflow&description=APK%20Forge&default_expires_at=none">this token page <ExternalLink className="h-3 w-3" /></a>{' '}
                  (scopes <span className="font-mono text-ink">repo</span> + <span className="font-mono text-ink">workflow</span> are pre-ticked).</li>
                <li><span className="font-mono text-droid">2.</span> Scroll down, click <b className="text-ink">Generate token</b>, copy it.</li>
                <li><span className="font-mono text-droid">3.</span> Paste it here and press Connect. Done forever.</li>
              </ol>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input className="input font-mono" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" />
                <button onClick={connect} disabled={busy} className="btn btn-primary">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Github className="h-4 w-4" />} Connect</button>
              </div>
              <p className="font-mono text-[11px] text-mute">Token is stored server-side in a private vault and never shown again.</p>
            </div>
          )}
          {err && <div className="mt-2 text-sm text-danger">{err}</div>}
        </div>
      </div>
    </div>
  );
}

export default function Agents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [nameErr, setNameErr] = useState('');
  const [creating, setCreating] = useState(false);
  const [shown, setShown] = useState<number | null>(null);
  const origin = window.location.origin;

  const fetchAgents = async () => {
    try { setError(''); setAgents(await api<Agent[]>('/api/agents')); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchAgents(); const t = setInterval(fetchAgents, 8000); return () => clearInterval(t); }, []);

  const create = async () => {
    setNameErr('');
    if (!name.trim()) return setNameErr('Give the agent a name, e.g. "office-mac" or "ci-vps".');
    setCreating(true);
    try {
      const a = await api<Agent>('/api/agents', { method: 'POST', body: { name } });
      setName(''); setShown(a.id); fetchAgents();
    } catch (e: any) { setNameErr(e.message); }
    finally { setCreating(false); }
  };
  const rotate = async (a: Agent) => {
    if (!confirm(`Rotate token for "${a.name}"? The running agent will be disconnected.`)) return;
    try { await api('/api/agents', { method: 'PUT', body: { id: a.id, rotate: true } }); setShown(a.id); fetchAgents(); }
    catch (e: any) { setError(e.message); }
  };
  const remove = async (a: Agent) => {
    if (!confirm(`Remove agent "${a.name}"?`)) return;
    try { await api('/api/agents', { method: 'DELETE', body: { id: a.id } }); fetchAgents(); }
    catch (e: any) { setError(e.message); }
  };

  const cmd = (token: string) => `curl -fsSL ${origin}/agent/apk-agent.mjs -o apk-agent.mjs\nnode apk-agent.mjs --server ${origin} --token ${token}`;

  return (
    <div>
      <PageHeader kicker="// workers" title="Build servers" />
      <CloudCard />
      <div className="mb-8 grid gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center gap-2 font-display font-semibold"><Terminal className="h-4 w-4 text-droid" /> Or: your own PC / server (optional)</div>
          <ol className="mt-3 space-y-2 text-sm text-mute">
            <li><span className="font-mono text-droid">01</span> Only <span className="text-ink">Node 18+</span> is needed on any Linux, macOS or Windows machine — <span className="text-droid">JDK, Android SDK, build-tools, licenses &amp; Gradle are installed and managed automatically</span>.</li>
            <li><span className="font-mono text-droid">02</span> Your agent <span className="text-ink">my-build-server</span> is already created — click Setup and paste the command once.</li>
            <li><span className="font-mono text-droid">03</span> The agent polls for queued builds, runs Gradle, streams logs here live and uploads the APK.</li>
          </ol>
          <a href="/agent/apk-agent.mjs" download className="mt-4 inline-block font-mono text-xs text-droid hover:underline">↓ download apk-agent.mjs</a>
        </div>
        <div className="card p-5">
          <label className="label">New agent name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} placeholder="build-server-01" />
          {nameErr && <div className="mt-1 text-xs text-danger">{nameErr}</div>}
          <button onClick={create} disabled={creating} className="btn btn-primary mt-3 w-full">{creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Register agent</button>
        </div>
      </div>

      {error && <div className="mb-6"><ErrorBox message={error} onRetry={fetchAgents} /></div>}
      {loading ? <Spinner /> : agents.length === 0 ? (
        <Empty icon={<Server />} title="No agents yet" text="Register your first build agent to start turning zips into APKs." />
      ) : (
        <div className="space-y-4">
          {agents.map((a) => (
            <div key={a.id} className="card p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex flex-1 items-center gap-3">
                  <div className={`relative grid h-10 w-10 place-items-center rounded-lg ${a.online ? 'bg-droid/10 text-droid' : 'bg-panel2 text-mute'}`}>
                    <Server className="h-5 w-5" />
                    <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-panel ${a.online ? 'bg-droid' : 'bg-line'}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-display font-semibold">{a.name}</div>
                    <div className="truncate font-mono text-xs text-mute">
                      {a.online ? (a.status === 'busy' ? `busy${a.current_build_id ? ` · build #${a.current_build_id}` : ''}` : 'online · idle') : `offline · last seen ${timeAgo(a.last_seen)}`}
                      {a.os && ` · ${a.os}`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setShown(shown === a.id ? null : a.id)} className="btn btn-ghost !px-3 !py-1.5 text-xs">{shown === a.id ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} Setup</button>
                  <button onClick={() => rotate(a)} title="Rotate token" className="rounded p-2 text-mute hover:text-amber"><RefreshCw className="h-4 w-4" /></button>
                  <button onClick={() => remove(a)} title="Remove" className="rounded p-2 text-mute hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
              {shown === a.id && (
                <div className="term mt-4 p-4">
                  <div className="mb-2 flex items-center justify-between font-mono text-[11px] uppercase tracking-wider text-mute"><span>run on your build machine</span><CopyBtn text={cmd(a.token)} /></div>
                  <pre className="overflow-x-auto whitespace-pre font-mono text-[12px] leading-6 text-ink/90"><span className="text-amber">$ </span>{cmd(a.token).split('\n')[0]}{'\n'}<span className="text-amber">$ </span>{cmd(a.token).split('\n')[1]}</pre>
                  <div className="mt-3 font-mono text-[11px] text-mute">Keep the token secret — it lets the agent pull your sources.</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
