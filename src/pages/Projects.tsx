import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { FolderArchive, Plus, X, Loader2, Package, Trash2 } from 'lucide-react';
import { api, uploadZip } from '../lib/api';
import { analyzeZip, type Analysis } from '../lib/analyze';
import type { Project, Toolchain } from '../lib/types';
import { taskFor } from '../lib/workflow';
import { PageHeader, Spinner, ErrorBox, Empty } from '../components/ui';
import ZipDrop, { MAX_ZIP } from '../components/ZipDrop';
import AnalysisPanel from '../components/AnalysisPanel';
import { fmtBytes, timeAgo } from '../lib/format';

export default function Projects() {
  const [params, setParams] = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(params.get('new') === '1');

  const fetchProjects = async () => {
    try { setError(''); setProjects(await api<Project[]>('/api/projects')); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchProjects(); }, []);

  const remove = async (p: Project) => {
    if (!confirm(`Delete "${p.name}" and all of its builds?`)) return;
    try { await api('/api/projects', { method: 'DELETE', body: { id: p.id } }); fetchProjects(); }
    catch (e: any) { setError(e.message); }
  };

  const close = () => { setOpen(false); if (params.get('new')) setParams({}); };

  return (
    <div>
      <PageHeader kicker="// sources" title="Projects">
        <button onClick={() => setOpen(true)} className="btn btn-primary"><Plus className="h-4 w-4" /> New project</button>
      </PageHeader>
      {error && <div className="mb-6"><ErrorBox message={error} onRetry={fetchProjects} /></div>}

      {loading ? <Spinner /> : projects.length === 0 ? (
        <Empty icon={<FolderArchive />} title="No projects yet" text="Zip your Android Studio project folder and upload it to get started."
          action={<button onClick={() => setOpen(true)} className="btn btn-primary"><Plus className="h-4 w-4" /> Upload zip</button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p, i) => (
            <motion.div key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              className="card group relative p-5 transition hover:border-droid/50">
              <Link to={`/projects/${p.id}`} className="absolute inset-0" aria-label={p.name} />
              <div className="flex items-start justify-between">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-droid/10 text-droid"><Package className="h-5 w-5" /></div>
                <button onClick={() => remove(p)} className="relative z-10 rounded p-1.5 text-mute opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100" aria-label="Delete">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 font-display text-lg font-semibold">{p.name}</div>
              <div className="truncate font-mono text-xs text-mute">{p.package_name || 'no package id'}</div>
              {p.description && <p className="mt-2 line-clamp-2 text-sm text-mute">{p.description}</p>}
              <div className="mt-4 flex flex-wrap gap-1.5">
                {p.analysis?.compileSdk && <span className="chip">SDK {p.analysis.compileSdk}</span>}
                {p.analysis?.agpVersion && <span className="chip">AGP {p.analysis.agpVersion}</span>}
                {p.analysis?.gradleVersion && <span className="chip">Gradle {p.analysis.gradleVersion}</span>}
                {p.analysis && <span className="chip">{p.analysis.kotlin ? 'Kotlin' : 'Java'}</span>}
              </div>
              <div className="mt-4 flex justify-between border-t border-line pt-3 font-mono text-[11px] text-mute">
                <span>{fmtBytes(p.zip_size)}</span><span>updated {timeAgo(p.updated_at || p.created_at)}</span>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>{open && <NewProjectModal onClose={close} />}</AnimatePresence>
    </div>
  );
}

function NewProjectModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [name, setName] = useState('');
  const [pkg, setPkg] = useState('');
  const [desc, setDesc] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [autoBuild, setAutoBuild] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const pick = async (f: File) => {
    setErrors({});
    if (!/\.zip$/i.test(f.name)) return setErrors({ file: 'Please choose a .zip file.' });
    if (f.size > MAX_ZIP) return setErrors({ file: `Zip is ${fmtBytes(f.size)} — limit is 50 MB. Remove build/ and .gradle/ folders.` });
    setFile(f); setAnalysis(null); setAnalyzing(true);
    try {
      const a = await analyzeZip(f);
      setAnalysis(a);
      setName((n) => n || f.name.replace(/\.zip$/i, '').replace(/[-_]+/g, ' '));
      setPkg((p) => p || a.applicationId || a.namespace || '');
    } catch {
      setErrors({ file: 'Could not read this zip — is it a valid archive?' });
      setFile(null);
    } finally { setAnalyzing(false); }
  };

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!file) e.file = 'Upload a project zip.';
    if (!name.trim()) e.name = 'Project name is required.';
    if (pkg && !/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(pkg)) e.pkg = 'Use a valid package id, e.g. com.example.app';
    setErrors(e);
    if (Object.keys(e).length || !file) return;
    try {
      setProgress(0);
      const path = await uploadZip(file, setProgress);
      const p = await api<Project>('/api/projects', {
        method: 'POST',
        body: { name, package_name: pkg, description: desc, zip_path: path, zip_name: file.name, zip_size: file.size, analysis },
      });
      if (autoBuild) {
        const tools = await api<Toolchain[]>('/api/toolchains');
        const en = tools.filter((t) => t.enabled);
        const pick = (kind: string, prefer?: string | null) => {
          const l = en.filter((t) => t.kind === kind);
          return (prefer && (l.find((t) => t.version === prefer) || l.find((t) => t.version.startsWith(prefer + '.')))?.version) || l.find((t) => t.is_default)?.version || l[0]?.version || '';
        };
        const mod = analysis?.appModule ?? 'app';
        const conn = await api<{ connected: boolean }>('/api/cloud').catch(() => ({ connected: false }));
        const b = await api<{ id: number }>('/api/builds', {
          method: 'POST',
          body: {
            runner: conn.connected ? 'cloud' : 'agent',
            project_id: p.id, build_type: 'debug', module: mod, gradle_task: taskFor(mod, 'debug'),
            jdk_version: pick('jdk', analysis?.recommendedJdk) || '17',
            sdk_platform: pick('android-sdk', analysis?.compileSdk ? String(analysis.compileSdk) : null),
            build_tools: pick('build-tools', analysis?.compileSdk ? String(analysis.compileSdk) : null),
            gradle_version: pick('gradle', analysis?.gradleVersion),
          },
        });
        return nav(`/builds/${b.id}`);
      }
      nav(`/projects/${p.id}`);
    } catch (err: any) {
      setErrors({ submit: err.message });
      setProgress(null);
    }
  };

  const uploading = progress !== null;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={() => !uploading && onClose()}>
      <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }} onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-line bg-panel p-6 sm:rounded-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">New project</h2>
          <button onClick={onClose} disabled={uploading} className="text-mute hover:text-ink"><X className="h-5 w-5" /></button>
        </div>

        {!file ? <ZipDrop onFile={pick} /> : (
          <div className="flex items-center gap-3 rounded-lg border border-line bg-panel2 p-3">
            <FolderArchive className="h-5 w-5 text-droid" />
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{file.name}</div><div className="font-mono text-xs text-mute">{fmtBytes(file.size)}</div></div>
            {!uploading && <button onClick={() => { setFile(null); setAnalysis(null); }} className="text-xs text-mute hover:text-danger">Change</button>}
          </div>
        )}
        {errors.file && <div className="mt-2 text-sm text-danger">{errors.file}</div>}
        {analyzing && <div className="mt-4"><Spinner label="Inspecting Gradle files…" /></div>}
        {analysis && <div className="mt-5"><AnalysisPanel a={analysis} /></div>}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Project name *</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="My App" />
            {errors.name && <div className="mt-1 text-xs text-danger">{errors.name}</div>}
          </div>
          <div>
            <label className="label">Package / application ID</label>
            <input className="input font-mono" value={pkg} onChange={(e) => setPkg(e.target.value)} placeholder="com.example.app" />
            {errors.pkg && <div className="mt-1 text-xs text-danger">{errors.pkg}</div>}
          </div>
          <div className="sm:col-span-2">
            <label className="label">Description</label>
            <textarea className="input min-h-20" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What does this app do?" />
          </div>
        </div>

        {uploading && (
          <div className="mt-5">
            <div className="mb-1 flex justify-between font-mono text-xs text-mute"><span>Uploading source…</span><span>{Math.round((progress ?? 0) * 100)}%</span></div>
            <div className="h-1.5 overflow-hidden rounded bg-panel2"><div className="h-full bg-droid transition-all" style={{ width: `${(progress ?? 0) * 100}%` }} /></div>
          </div>
        )}
        <label className="mt-5 flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={autoBuild} onChange={(e) => setAutoBuild(e.target.checked)} className="accent-[#3ddc84]" />
          Build debug APK immediately (JDK / SDK / Gradle auto-selected)
        </label>
        {errors.submit && <div className="mt-4"><ErrorBox message={errors.submit} /></div>}

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} disabled={uploading} className="btn btn-ghost">Cancel</button>
          <button onClick={submit} disabled={uploading || analyzing} className="btn btn-primary">
            {uploading && <Loader2 className="h-4 w-4 animate-spin" />} {autoBuild ? 'Upload & build APK' : 'Create project'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
