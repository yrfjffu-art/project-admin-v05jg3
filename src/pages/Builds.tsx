import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Hammer, Download } from 'lucide-react';
import { api } from '../lib/api';
import type { Build, BuildStatus } from '../lib/types';
import { PageHeader, Spinner, ErrorBox, StatusBadge, Empty } from '../components/ui';
import { duration, fmtBytes, timeAgo } from '../lib/format';

const FILTERS: ('all' | BuildStatus)[] = ['all', 'queued', 'running', 'success', 'failed', 'cancelled'];

export default function Builds() {
  const [builds, setBuilds] = useState<Build[]>([]);
  const [filter, setFilter] = useState<'all' | BuildStatus>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchBuilds = async () => {
    try {
      setError('');
      await api('/api/cloud', { method: 'POST', body: { action: 'sync' } }).catch(() => {});
      setBuilds(await api<Build[]>(`/api/builds?limit=200${filter !== 'all' ? `&status=${filter}` : ''}`));
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { setLoading(true); fetchBuilds(); const t = setInterval(fetchBuilds, 6000); return () => clearInterval(t); }, [filter]);

  return (
    <div>
      <PageHeader kicker="// pipeline" title="Builds" />
      <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`shrink-0 rounded-full border px-3.5 py-1.5 font-mono text-xs uppercase tracking-wider transition ${filter === f ? 'border-droid bg-droid/10 text-droid' : 'border-line text-mute hover:text-ink'}`}>{f}</button>
        ))}
      </div>
      {error && <div className="mb-4"><ErrorBox message={error} onRetry={fetchBuilds} /></div>}
      {loading ? <Spinner /> : builds.length === 0 ? (
        <Empty icon={<Hammer />} title="Nothing here" text={filter === 'all' ? 'Queue a build from any project page.' : `No ${filter} builds.`}
          action={<Link to="/projects" className="btn btn-primary">Go to projects</Link>} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wider text-mute">
                <th className="px-4 py-3">Build</th><th className="px-4 py-3">Project</th><th className="px-4 py-3">Task</th><th className="px-4 py-3">Toolchain</th><th className="px-4 py-3">Agent</th><th className="px-4 py-3">Time</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {builds.map((b) => (
                <tr key={b.id} className="hover:bg-panel2">
                  <td className="px-4 py-3 font-mono"><Link to={`/builds/${b.id}`} className="text-droid hover:underline">#{b.id}</Link></td>
                  <td className="px-4 py-3"><Link to={`/projects/${b.project_id}`} className="hover:text-droid">{b.projects?.name}</Link></td>
                  <td className="px-4 py-3 font-mono text-xs">{b.gradle_task}</td>
                  <td className="px-4 py-3 font-mono text-xs text-mute">JDK {b.jdk_version} · SDK {b.sdk_platform || '—'}</td>
                  <td className="px-4 py-3 text-xs text-mute">{b.agent_name || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-mute">{timeAgo(b.created_at)}<br />{duration(b.started_at, b.finished_at)}</td>
                  <td className="px-4 py-3"><StatusBadge status={b.status} /></td>
                  <td className="px-4 py-3 text-right">{b.apk_url && <a href={b.apk_url} title={fmtBytes(b.apk_size)} className="inline-flex items-center gap-1 text-xs text-droid hover:underline"><Download className="h-3.5 w-3.5" />APK</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
