import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Play, Github, Download, Pencil, RefreshCw, Loader2, Server, Save, Cloud } from 'lucide-react';
import { api, uploadZip } from '../lib/api';
import { analyzeZip } from '../lib/analyze';
import type { Agent, Build, CloudConn, Project, Toolchain } from '../lib/types';
import { PageHeader, Spinner, ErrorBox, StatusBadge } from '../components/ui';
import AnalysisPanel from '../components/AnalysisPanel';
import ZipDrop, { MAX_ZIP } from '../components/ZipDrop';
import { duration, fmtBytes, timeAgo } from '../lib/format';
import { download, makeWorkflow, taskFor } from '../lib/workflow';

export default function ProjectDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [builds, setBuilds] = useState<Build[]>([]);
  const [tools, setTools] = useState<Toolchain[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [cloud, setCloud] = useState<CloudConn>({ connected: false });
  const [runner, setRunner] = useState<'cloud' | 'agent'>('cloud');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [buildType, setBuildType] = useState<'debug' | 'release'>('debug');
  const [module, setModule] = useState('app');
  const [task, setTask] = useState('');
  const [taskEdited, setTaskEdited] = useState(false);
  const [jdk, setJdk] = useState('');
  const [sdk, setSdk] = useState('');
  const [bt, setBt] = useState('');
  const [gradle, setGradle] = useState('');
  const [extra, setExtra] = useState('');
  const [queueing, setQueueing] = useState(false);
  const [formError, setFormError] = useState('');

  const [editing, setEditing] = useState(false);
  const [eName, setEName] = useState('');
  const [ePkg, setEPkg] = useState('');
  const [eDesc, setEDesc] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [replaceProgress, setReplaceProgress] = useState<number | null>(null);

  const load = async () => {
    try {
      setError('');
      const [p, b, t, a, c] = await Promise.all([
        api<Project>(`/api/projects?id=${id}`),
        api<Build[]>(`/api/builds?project_id=${id}`),
        api<Toolchain[]>('/api/toolchains'),
        api<Agent[]>('/api/agents'),
        api<CloudConn>('/api/cloud'),
      ]);
      setProject(p); setBuilds(b); setTools(t); setAgents(a); setCloud(c);
      setRunner(c.connected || !a.some((x) => x.online) ? 'cloud' : 'agent');
      return { p, t };
    } catch (e: any) { setError(e.message); return null; }
    finally { setLoading(false); }
  };

  const applyDefaults = (p: Project, t: Toolchain[]) => {
    const a = p.analysis;
    const en = t.filter((x) => x.enabled);
    const choose = (kind: string, prefer?: string | null) => {
      const list = en.filter((x) => x.kind === kind);
      if (prefer) {
        const m = list.find((x) => x.version === prefer) || list.find((x) => x.version.startsWith(prefer + '.'));
        if (m) return m.version;
      }
      return list.find((x) => x.is_default)?.version || list[0]?.version || '';
    };
    const mod = a?.appModule ?? 'app';
    setModule(mod);
    setTask(taskFor(mod, 'debug'));
    setJdk(choose('jdk', a?.recommendedJdk));
    setSdk(choose('android-sdk', a?.compileSdk ? String(a.compileSdk) : null));
    setBt(choose('build-tools', a?.compileSdk ? String(a.compileSdk) : null));
    setGradle(choose('gradle', a?.gradleVersion));
    setEName(p.name); setEPkg(p.package_name || ''); setEDesc(p.description || '');
  };

  useEffect(() => {
    load().then((r) => r && applyDefaults(r.p, r.t));
    const t = setInterval(() => {
      api<Build[]>(`/api/builds?project_id=${id}`).then(setBuilds).catch(() => {});
    }, 8000);
    return () => clearInterval(t);
  }, [id]);

  useEffect(() => { if (!taskEdited) setTask(taskFor(module, buildType)); }, [module, buildType]);

  const byKind = useMemo(() => (k: string) => tools.filter((t) => t.kind === k && t.enabled), [tools]);
  const online = agents.filter((a) => a.online).length;

  const queue = async () => {
    setFormError('');
    if (!jdk) return setFormError('Select a JDK version (add one under Toolchains).');
    if (!task.trim()) return setFormError('Gradle task is required.');
    if (runner === 'cloud' && !cloud.connected) return setFormError('Connect GitHub first (Build Servers page) — it takes one minute.');
    setQueueing(true);
    try {
      const b = await api<Build>('/api/builds', {
        method: 'POST',
        body: { runner, project_id: Number(id), build_type: buildType, module, gradle_task: task, jdk_version: jdk, sdk_platform: sdk, build_tools: bt, gradle_version: gradle, extra_args: extra },
      });
      nav(`/builds/${b.id}`);
    } catch (e: any) { setFormError(e.message); setQueueing(false); }
  };

  const saveMeta = async () => {
    if (!eName.trim()) return setError('Project name is required.');
    try {
      const p = await api<Project>('/api/projects', { method: 'PUT', body: { id: Number(id), name: eName, package_name: ePkg, description: eDesc } });
      setProject(p); setEditing(false);
    } catch (e: any) { setError(e.message); }
  };

  const replaceZip = async (f: File) => {
    if (!/\.zip$/i.test(f.name)) return setError('Please choose a .zip file.');
    if (f.size > MAX_ZIP) return setError('Zip exceeds the 50 MB limit.');
    try {
      setReplaceProgress(0);
      const analysis = await analyzeZip(f).catch(() => null);
      const path = await uploadZip(f, setReplaceProgress);
      const p = await api<Project>('/api/projects', { method: 'PUT', body: { id: Number(id), zip_path: path, zip_name: f.name, zip_size: f.size, analysis } });
      setProject(p); applyDefaults(p, tools); setReplacing(false);
    } catch (e: any) { setError(e.message); }
    finally { setReplaceProgress(null); }
  };

  const exportWorkflow = () => {
    if (!project) return;
    download(`build-${project.name.replace(/\W+/g, '-').toLowerCase()}.yml`, makeWorkflow({
      name: project.name, task, module, jdk: jdk || '17', sdk, buildTools: bt, gradleVersion: gradle,
      hasWrapper: project.analysis?.hasWrapper ?? true, root: project.analysis?.root ?? '',
    }));
  };

  if (loading) return <Spinner label="Loading project…" />;
  if (!project) return <ErrorBox message={error || 'Project not found'} />;

  const Select = ({ label, value, set, kind, optional }: { label: string; value: string; set: (v: string) => void; kind: string; optional?: boolean }) => (
    <div>
      <label className="label">{label}</label>
      <select className="input" value={value} onChange={(e) => set(e.target.value)}>
        {optional && <option value="">{kind === 'gradle' ? 'Use project wrapper' : 'Auto / not required'}</option>}
        {byKind(kind).map((t) => <option key={t.id} value={t.version}>{t.label || t.version}{t.is_default ? ' (default)' : ''}</option>)}
      </select>
    </div>
  );

  return (
    <div>
      <Link to="/projects" className="mb-4 inline-flex items-center gap-1.5 text-sm text-mute hover:text-droid"><ArrowLeft className="h-4 w-4" /> Projects</Link>
      <PageHeader kicker={project.package_name || '// project'} title={project.name}>
        <button onClick={() => setEditing((v) => !v)} className="btn btn-ghost"><Pencil className="h-4 w-4" /> Edit</button>
        {project.zip_url && <a href={project.zip_url} className="btn btn-ghost"><Download className="h-4 w-4" /> Source</a>}
      </PageHeader>
      {error && <div className="mb-6"><ErrorBox message={error} /></div>}

      {editing && (
        <div className="card mb-6 grid gap-4 p-5 sm:grid-cols-2">
          <div><label className="label">Name</label><input className="input" value={eName} onChange={(e) => setEName(e.target.value)} /></div>
          <div><label className="label">Package ID</label><input className="input font-mono" value={ePkg} onChange={(e) => setEPkg(e.target.value)} /></div>
          <div className="sm:col-span-2"><label className="label">Description</label><textarea className="input" value={eDesc} onChange={(e) => setEDesc(e.target.value)} /></div>
          <div className="flex gap-2 sm:col-span-2"><button onClick={saveMeta} className="btn btn-primary"><Save className="h-4 w-4" /> Save</button><button onClick={() => setEditing(false)} className="btn btn-ghost">Cancel</button></div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <section className="card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Source analysis</h2>
              <button onClick={() => setReplacing((v) => !v)} className="text-sm text-mute hover:text-droid"><RefreshCw className="mr-1 inline h-3.5 w-3.5" />Replace zip</button>
            </div>
            <div className="mb-4 font-mono text-xs text-mute">{project.zip_name} · {fmtBytes(project.zip_size)} · uploaded {timeAgo(project.updated_at || project.created_at)}</div>
            {replacing && (
              <div className="mb-5">
                {replaceProgress !== null ? <Spinner label={`Uploading… ${Math.round(replaceProgress * 100)}%`} /> : <ZipDrop compact onFile={replaceZip} />}
              </div>
            )}
            {project.analysis ? <AnalysisPanel a={project.analysis} /> : <div className="text-sm text-mute">No analysis available.</div>}
          </section>

          <section className="card">
            <div className="border-b border-line px-5 py-4 font-display text-lg font-semibold">Build history</div>
            {builds.length === 0 ? <div className="px-5 py-10 text-center text-sm text-mute">No builds for this project yet.</div> : (
              <div className="divide-y divide-line">
                {builds.map((b) => (
                  <Link key={b.id} to={`/builds/${b.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-panel2">
                    <span className="font-mono text-xs text-mute">#{b.id}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-sm">{b.gradle_task}</div>
                      <div className="font-mono text-[11px] text-mute">JDK {b.jdk_version} · SDK {b.sdk_platform || '—'} · {timeAgo(b.created_at)} · {duration(b.started_at, b.finished_at)}</div>
                    </div>
                    {b.apk_url && <span className="chip text-droid">APK</span>}
                    <StatusBadge status={b.status} />
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="lg:col-span-2">
          <section className="card sticky top-20 p-5">
            <h2 className="font-display text-lg font-semibold">Build configuration</h2>
            <label className="label mt-4">Build on</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setRunner('cloud')} className={`rounded-lg border p-3 text-left transition ${runner === 'cloud' ? 'border-droid bg-droid/10' : 'border-line hover:border-droid/40'}`}>
                <div className="flex items-center gap-2 text-sm font-semibold"><Cloud className="h-4 w-4 text-droid" /> Cloud</div>
                <div className={`mt-1 font-mono text-[11px] ${cloud.connected ? 'text-droid' : 'text-amber'}`}>{cloud.connected ? `GitHub · ${cloud.login}` : 'not connected'}</div>
              </button>
              <button onClick={() => setRunner('agent')} className={`rounded-lg border p-3 text-left transition ${runner === 'agent' ? 'border-droid bg-droid/10' : 'border-line hover:border-droid/40'}`}>
                <div className="flex items-center gap-2 text-sm font-semibold"><Server className="h-4 w-4 text-sky" /> My server</div>
                <div className={`mt-1 font-mono text-[11px] ${online ? 'text-droid' : 'text-mute'}`}>{online} online</div>
              </button>
            </div>
            {runner === 'cloud' && !cloud.connected && <Link to="/agents" className="mt-2 block text-xs text-amber underline">Connect GitHub (free, 1 minute) →</Link>}
            {runner === 'agent' && !online && <Link to="/agents" className="mt-2 block text-xs text-amber underline">No server online — get the command →</Link>}

            <div className="mt-5 grid grid-cols-2 gap-2 rounded-lg border border-line bg-panel2 p-1">
              {(['debug', 'release'] as const).map((t) => (
                <button key={t} onClick={() => setBuildType(t)} className={`rounded-md py-2 text-sm font-medium capitalize transition ${buildType === t ? 'bg-droid text-bg' : 'text-mute hover:text-ink'}`}>{t}</button>
              ))}
            </div>
            {buildType === 'release' && <p className="mt-2 text-xs text-amber">Release APKs are unsigned unless your build.gradle defines a signingConfig.</p>}

            <div className="mt-4 grid gap-4">
              <div className="grid grid-cols-2 gap-3">
                <Select label="JDK" value={jdk} set={setJdk} kind="jdk" />
                <Select label="SDK platform" value={sdk} set={setSdk} kind="android-sdk" optional />
                <Select label="Build tools" value={bt} set={setBt} kind="build-tools" optional />
                <Select label="Gradle" value={gradle} set={setGradle} kind="gradle" optional />
              </div>
              <div>
                <label className="label">App module</label>
                <input className="input font-mono" value={module} onChange={(e) => setModule(e.target.value)} list="modules" placeholder="app" />
                <datalist id="modules">{project.analysis?.modules.map((m) => <option key={m} value={m} />)}</datalist>
              </div>
              <div>
                <label className="label">Gradle task</label>
                <input className="input font-mono" value={task} onChange={(e) => { setTask(e.target.value); setTaskEdited(true); }} />
              </div>
              <div>
                <label className="label">Extra Gradle args</label>
                <input className="input font-mono" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="--info -Pversion=1.2" />
              </div>
            </div>
            {formError && <div className="mt-3 text-sm text-danger">{formError}</div>}
            <button onClick={queue} disabled={queueing} className="btn btn-primary mt-5 w-full">
              {queueing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Build APK
            </button>
            <button onClick={exportWorkflow} className="btn btn-ghost mt-2 w-full"><Github className="h-4 w-4" /> Export GitHub Actions workflow</button>
            <p className="mt-2 text-center text-[11px] text-mute">Drop the .yml into <span className="font-mono">.github/workflows/</span> to build in the cloud.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
