import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FolderArchive, Hammer, CheckCircle2, Server, ArrowRight, Upload, Download } from 'lucide-react';
import { api } from '../lib/api';
import type { Agent, Build, Project } from '../lib/types';
import { PageHeader, Spinner, ErrorBox, StatusBadge, Empty } from '../components/ui';
import { duration, fmtBytes, timeAgo } from '../lib/format';

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [builds, setBuilds] = useState<Build[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [cloud, setCloud] = useState<{ connected: boolean }>({ connected: true });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setError('');
      const [p, b, a] = await Promise.all([
        api<Project[]>('/api/projects'),
        api<Build[]>('/api/builds?limit=100'),
        api<Agent[]>('/api/agents'),
      ]);
      setProjects(p); setBuilds(b); setAgents(a);
      api<{ connected: boolean }>('/api/cloud').then(setCloud).catch(() => {});
      api('/api/cloud', { method: 'POST', body: { action: 'sync' } }).catch(() => {});
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);

  if (loading) return <Spinner label="Loading dashboard…" />;

  const finished = builds.filter((b) => b.status === 'success' || b.status === 'failed');
  const rate = finished.length ? Math.round((builds.filter((b) => b.status === 'success').length / finished.length) * 100) : null;
  const online = agents.filter((a) => a.online).length;
  const active = builds.filter((b) => b.status === 'queued' || b.status === 'running').length;

  const stats = [
    { label: 'Projects', value: projects.length, icon: FolderArchive, to: '/projects' },
    { label: 'Active builds', value: active, icon: Hammer, to: '/builds' },
    { label: 'Success rate', value: rate === null ? '—' : `${rate}%`, icon: CheckCircle2, to: '/builds' },
    { label: 'Agents online', value: `${online}/${agents.length}`, icon: Server, to: '/agents' },
  ];

  return (
    <div>
      <PageHeader kicker="// overview" title="Build control room">
        <Link to="/projects?new=1" className="btn btn-primary"><Upload className="h-4 w-4" /> Upload project</Link>
      </PageHeader>
      {error && <div className="mb-6"><ErrorBox message={error} onRetry={load} /></div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <Link to={s.to} className="card group block p-5 transition hover:border-droid/50">
              <div className="flex items-center justify-between text-mute">
                <span className="font-mono text-[11px] uppercase tracking-widest">{s.label}</span>
                <s.icon className="h-4 w-4 group-hover:text-droid" />
              </div>
              <div className="mt-3 font-display text-3xl font-bold">{s.value}</div>
            </Link>
          </motion.div>
        ))}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          ['01', 'Upload', 'Drop your project .zip — everything is auto-detected.', '/projects?new=1'],
          ['02', 'Build', 'JDK, SDK, build-tools & Gradle are installed and picked for you.', '/builds'],
          ['03', 'Install', 'Scan the QR on the build page and install on your phone.', '/builds'],
        ].map(([n, t, d, to]) => (
          <Link key={n} to={to} className="card p-4 transition hover:border-droid/50">
            <div className="font-mono text-xs text-droid">{n}</div>
            <div className="font-display font-semibold">{t}</div>
            <p className="text-sm text-mute">{d}</p>
          </Link>
        ))}
      </div>

      {online === 0 && !cloud.connected && (
        <div className="mt-6 flex flex-col gap-3 rounded-xl border border-amber/40 bg-amber/5 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-display font-semibold text-amber">Connect the free cloud builder</div>
            <p className="text-sm text-mute">No PC needed: connect GitHub once and every APK builds on GitHub's servers (JDK, Android SDK &amp; Gradle installed automatically).</p>
          </div>
          <Link to="/agents" className="btn btn-ghost shrink-0">Connect GitHub <ArrowRight className="h-4 w-4" /></Link>
        </div>
      )}

      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Recent builds</h2>
            <Link to="/builds" className="text-sm text-mute hover:text-droid">View all</Link>
          </div>
          {builds.length === 0 ? (
            <Empty icon={<Hammer />} title="No builds yet" text="Upload a project zip and queue your first build." />
          ) : (
            <div className="card divide-y divide-line">
              {builds.slice(0, 8).map((b) => (
                <Link key={b.id} to={`/builds/${b.id}`} className="flex items-center gap-4 px-4 py-3 transition hover:bg-panel2">
                  <div className="font-mono text-xs text-mute">#{b.id}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{b.projects?.name}</div>
                    <div className="truncate font-mono text-xs text-mute">{b.gradle_task} · JDK {b.jdk_version}</div>
                  </div>
                  <div className="hidden text-right font-mono text-xs text-mute sm:block">
                    <div>{timeAgo(b.created_at)}</div>
                    <div>{duration(b.started_at, b.finished_at)}</div>
                  </div>
                  <StatusBadge status={b.status} />
                </Link>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-3 font-display text-lg font-semibold">Latest artifacts</h2>
          <div className="card divide-y divide-line">
            {builds.filter((b) => b.apk_url).slice(0, 5).map((b) => (
              <div key={b.id} className="flex items-center gap-3 px-4 py-3">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-droid/10 text-droid"><Download className="h-4 w-4" /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{b.projects?.name}</div>
                  <div className="font-mono text-xs text-mute">{b.build_type} · {fmtBytes(b.apk_size)}</div>
                </div>
                <a href={b.apk_url!} className="text-xs text-droid hover:underline">APK</a>
              </div>
            ))}
            {!builds.some((b) => b.apk_url) && <div className="px-4 py-8 text-center text-sm text-mute">Successful builds will appear here.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
