import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Square, RotateCcw, Trash2, Server, Copy, Smartphone } from 'lucide-react';
import { api } from '../lib/api';
import type { Agent, Build } from '../lib/types';
import { ErrorBox, Spinner, StatusBadge } from '../components/ui';
import { duration, fmtBytes, timeAgo } from '../lib/format';

function lineClass(l: string) {
  if (/BUILD SUCCESSFUL|✔/.test(l)) return 'text-droid';
  if (/FAILURE|FAILED|error:|Exception|✖|^e: /i.test(l)) return 'text-danger';
  if (/warning|⚠|^w: /i.test(l)) return 'text-amber';
  if (/^\[(forge|agent)\]/.test(l)) return 'text-sky';
  if (/^> Task/.test(l)) return 'text-mute';
  if (/^\$ /.test(l)) return 'text-amber';
  return 'text-ink/85';
}

export default function BuildDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [build, setBuild] = useState<Build | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [follow, setFollow] = useState(true);
  const [busy, setBusy] = useState(false);
  const termRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      let b = await api<Build>(`/api/builds?id=${id}`);
      if (b.agent_id === -1 && (b.status === 'queued' || b.status === 'running')) {
        await api('/api/cloud', { method: 'POST', body: { action: 'sync', build_id: Number(id) } }).catch(() => {});
        b = await api<Build>(`/api/builds?id=${id}`);
      }
      setBuild(b); setError('');
      return b;
    } catch (e: any) { setError(e.message); return null; }
    finally { setLoading(false); }
  };

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const tick = async () => {
      const b = await load();
      if (!alive) return;
      if (b && (b.status === 'queued' || b.status === 'running')) timer = setTimeout(tick, b.agent_id === -1 ? 5000 : 2000);
    };
    tick();
    api<Agent[]>('/api/agents').then(setAgents).catch(() => {});
    return () => { alive = false; clearTimeout(timer); };
  }, [id]);

  useEffect(() => {
    if (follow && termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [build?.logs, follow]);

  const cancel = async () => {
    setBusy(true);
    try { await api('/api/builds', { method: 'PUT', body: { id: Number(id), action: 'cancel' } }); await load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const rebuild = async () => {
    if (!build) return;
    setBusy(true);
    try {
      const nb = await api<Build>('/api/builds', {
        method: 'POST',
        body: { runner: build.agent_id === -1 ? 'cloud' : 'agent', project_id: build.project_id, build_type: build.build_type, module: build.module, gradle_task: build.gradle_task, jdk_version: build.jdk_version, sdk_platform: build.sdk_platform, build_tools: build.build_tools, gradle_version: build.gradle_version, extra_args: build.extra_args },
      });
      nav(`/builds/${nb.id}`);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const rebuildCloud = async () => {
    if (!build) return;
    setBusy(true);
    try {
      const nb = await api<Build>('/api/builds', {
        method: 'POST',
        body: { runner: 'cloud', project_id: build.project_id, build_type: build.build_type, module: build.module, gradle_task: build.gradle_task, jdk_version: build.jdk_version, sdk_platform: build.sdk_platform, build_tools: build.build_tools, gradle_version: build.gradle_version, extra_args: build.extra_args },
      });
      nav(`/builds/${nb.id}`);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!confirm('Delete this build and its APK?')) return;
    try { await api('/api/builds', { method: 'DELETE', body: { id: Number(id) } }); nav('/builds'); }
    catch (e: any) { setError(e.message); }
  };

  if (loading) return <Spinner label="Loading build…" />;
  if (!build) return <ErrorBox message={error || 'Build not found'} />;

  const lines = (build.logs || '').split('\n');
  const active = build.status === 'queued' || build.status === 'running';
  const online = agents.filter((a) => a.online).length;

  return (
    <div>
      <Link to={`/projects/${build.project_id}`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-mute hover:text-droid"><ArrowLeft className="h-4 w-4" /> {build.projects?.name}</Link>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-3xl font-bold">Build #{build.id}</h1>
            <StatusBadge status={build.status} />
          </div>
          <div className="mt-1 font-mono text-sm text-mute">{build.gradle_task}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {build.apk_url && <a href={build.apk_url} className="btn btn-primary"><Download className="h-4 w-4" /> Download APK</a>}
          {active && <button onClick={cancel} disabled={busy} className="btn btn-ghost"><Square className="h-4 w-4" /> Cancel</button>}
          {!active && <button onClick={rebuild} disabled={busy} className="btn btn-ghost"><RotateCcw className="h-4 w-4" /> Rebuild</button>}
          {!active && build.agent_id !== -1 && <button onClick={() => rebuildCloud()} disabled={busy} className="btn btn-ghost"><RotateCcw className="h-4 w-4" /> Rebuild in Cloud</button>}
          {!active && <button onClick={remove} className="btn btn-ghost hover:!text-danger"><Trash2 className="h-4 w-4" /></button>}
        </div>
      </div>
      {error && <div className="mb-4"><ErrorBox message={error} /></div>}

      {build.status === 'queued' && build.agent_id !== -1 && online === 0 && (
        <div className="mb-5 flex flex-col gap-3 rounded-xl border border-amber/40 bg-amber/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3 text-sm"><Server className="mt-0.5 h-4 w-4 text-amber" /><span>No build server is online. Cancel this and click Rebuild with <b>Cloud</b> selected — or connect GitHub on the Build Servers page for zero-setup builds.</span></div>
          <Link to="/agents" className="btn btn-ghost shrink-0">Set up agent</Link>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4 lg:grid-cols-8">
        {[
          ['Type', build.build_type], ['JDK', build.jdk_version], ['SDK', build.sdk_platform || 'auto'], ['Build tools', build.build_tools || 'auto'],
          ['Gradle', build.gradle_version || 'wrapper'], ['Agent', build.agent_name || '—'], ['Duration', duration(build.started_at, build.finished_at)], ['APK', fmtBytes(build.apk_size)],
        ].map(([k, v]) => (
          <div key={k} className="bg-panel px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-wider text-mute">{k}</div>
            <div className="truncate font-mono text-sm">{v}</div>
          </div>
        ))}
      </div>

      {build.apk_url && (
        <div className="card mb-5 flex flex-col items-center gap-5 p-5 sm:flex-row">
          <img src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&data=${encodeURIComponent(build.apk_url)}`} alt="Scan to install APK" className="h-36 w-36 rounded-lg bg-white" />
          <div className="flex-1 text-center sm:text-left">
            <div className="font-display text-lg font-semibold text-droid">Install on your phone</div>
            <ol className="mt-2 space-y-1 text-sm text-mute">
              <li>1. Scan this QR with your Android phone camera (or open this page on the phone).</li>
              <li>2. Download the APK and tap it to open.</li>
              <li>3. Allow “Install unknown apps” for your browser when asked, then tap Install.</li>
            </ol>
            <a href={build.apk_url} download className="btn btn-primary mt-4"><Smartphone className="h-4 w-4" /> Install APK ({fmtBytes(build.apk_size)})</a>
          </div>
        </div>
      )}

      {build.error && <div className="mb-4"><ErrorBox message={build.error} /></div>}

      <div className="term overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-danger/70" /><span className="h-2.5 w-2.5 rounded-full bg-amber/70" /><span className="h-2.5 w-2.5 rounded-full bg-droid/70" />
            <span className="ml-2 font-mono text-xs text-mute">gradle — build-{build.id}.log {active && <span className="text-sky">● live</span>}</span>
          </div>
          <div className="flex items-center gap-3 font-mono text-xs text-mute">
            <label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-[#3ddc84]" /> follow</label>
            <button onClick={() => navigator.clipboard.writeText(build.logs || '')} className="hover:text-ink" aria-label="Copy logs"><Copy className="h-3.5 w-3.5" /></button>
          </div>
        </div>
        <div ref={termRef} className="h-[55vh] overflow-auto p-4 font-mono text-[12px] leading-[1.6]">
          {lines.map((l, i) => (
            <div key={i} className="flex gap-4 whitespace-pre-wrap break-all">
              <span className="w-8 shrink-0 select-none text-right text-mute/40">{i + 1}</span>
              <span className={lineClass(l)}>{l || ' '}</span>
            </div>
          ))}
          {active && <div className="ml-12 mt-1 h-3.5 w-2 animate-pulse bg-droid" />}
        </div>
      </div>
      <div className="mt-3 font-mono text-xs text-mute">queued {timeAgo(build.created_at)}{build.finished_at && ` · finished ${timeAgo(build.finished_at)}`}</div>
    </div>
  );
}
