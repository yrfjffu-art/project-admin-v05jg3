import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Globe, Loader2, Rocket, Cloud, Server, ExternalLink } from 'lucide-react';
import { api } from '../lib/api';
import type { Agent, CloudConn, Project } from '../lib/types';
import { PageHeader, ErrorBox, Spinner } from '../components/ui';
import { timeAgo } from '../lib/format';

const KEYWORDS = new Set('as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while abstract assert boolean byte case catch char const default double enum extends final finally float goto implements import instanceof int long native new private protected public short static strictfp switch synchronized throws transient void volatile record yield sealed permits _'.split(' '));

function packageError(p: string) {
  if (!p) return '';
  const segs = p.split('.');
  if (segs.length < 2) return 'Needs at least two segments, e.g. com.example.app';
  for (const s of segs) {
    if (!/^[a-z][a-z0-9_]*$/.test(s)) return `"${s}": lowercase letters, digits and _ only, starting with a letter`;
    if (KEYWORDS.has(s)) return `"${s}" is a reserved Java/Kotlin keyword`;
  }
  return '';
}

export default function WebBuild() {
  const nav = useNavigate();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [pkg, setPkg] = useState('');
  const [icon, setIcon] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [cloud, setCloud] = useState<CloudConn | null>(null);
  const [online, setOnline] = useState(0);
  const [recent, setRecent] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api<CloudConn>('/api/cloud').then(setCloud),
      api<Agent[]>('/api/agents').then((a) => setOnline(a.filter((x) => x.online).length)),
      api<Project[]>('/api/projects').then((p) => setRecent(p.filter((x) => (x.analysis as any)?.websiteUrl).slice(0, 6))),
    ]).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    try { const u = new URL(url.trim()); if (!/^https?:$/.test(u.protocol)) throw 0; } catch { errs.url = 'Enter a full website address, e.g. https://example.com'; }
    if (name.length > 50) errs.name = 'Max 50 characters';
    const pe = packageError(pkg.trim());
    if (pe) errs.pkg = pe;
    if (icon.trim()) { try { if (new URL(icon.trim()).protocol !== 'https:') throw 0; } catch { errs.icon = 'Icon must be an https:// link to a PNG, JPEG or WebP'; } }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const r = await api<{ id: number }>('/api/web-builds', { method: 'POST', body: { url: url.trim(), app_name: name.trim(), package_name: pkg.trim(), icon_url: icon.trim() } });
      nav(`/builds/${r.id}`);
    } catch (err: any) {
      setErrors({ submit: err.message });
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader kicker="// website → android" title="Website to APK" />
      <div className="grid gap-6 lg:grid-cols-5">
        <form onSubmit={submit} className="card space-y-4 p-6 lg:col-span-3">
          <div>
            <label className="label">Website URL *</label>
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" />
              <input className="input pl-9 font-mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-site.com" autoFocus />
            </div>
            {errors.url && <div className="mt-1 text-xs text-danger">{errors.url}</div>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">App name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Uses the page title if empty" maxLength={50} />
              {errors.name && <div className="mt-1 text-xs text-danger">{errors.name}</div>}
            </div>
            <div>
              <label className="label">Package name</label>
              <input className="input font-mono" value={pkg} onChange={(e) => setPkg(e.target.value.toLowerCase())} placeholder="auto from domain" />
              {errors.pkg && <div className="mt-1 text-xs text-danger">{errors.pkg}</div>}
            </div>
          </div>
          <div>
            <label className="label">Icon URL (optional)</label>
            <input className="input font-mono" value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="https://…/icon.png  (PNG/JPEG/WebP, max 1 MB)" />
            {errors.icon && <div className="mt-1 text-xs text-danger">{errors.icon}</div>}
          </div>
          {errors.submit && <ErrorBox message={errors.submit} />}
          <button className="btn btn-primary w-full" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} Build APK
          </button>
          <p className="text-xs text-mute">Generates a Kotlin WebView app (JDK 17 · SDK 35 · Gradle 8.11.1) and compiles it. The same pipeline runs for the Telegram bot and the public API.</p>
        </form>

        <div className="space-y-4 lg:col-span-2">
          <div className="card p-5">
            <div className="font-display font-semibold">Where it builds</div>
            {loading ? <div className="mt-3"><Spinner /></div> : (
              <div className="mt-3 space-y-2 text-sm">
                <div className={`flex items-center gap-2 ${cloud?.connected ? 'text-droid' : 'text-mute'}`}><Cloud className="h-4 w-4" /> Cloud: {cloud?.connected ? `GitHub · ${cloud.login}` : 'not connected'}</div>
                <div className={`flex items-center gap-2 ${online ? 'text-droid' : 'text-mute'}`}><Server className="h-4 w-4" /> Own servers online: {online}</div>
                {!cloud?.connected && !online && <Link to="/agents" className="inline-flex items-center gap-1 text-amber underline">Connect a builder first <ExternalLink className="h-3 w-3" /></Link>}
              </div>
            )}
          </div>
          <div className="card">
            <div className="border-b border-line px-5 py-3 font-display font-semibold">Recent website apps</div>
            {recent.length === 0 ? <div className="px-5 py-6 text-sm text-mute">None yet.</div> : recent.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="block border-b border-line px-5 py-3 last:border-0 hover:bg-panel2">
                <div className="text-sm font-medium">{p.name}</div>
                <div className="truncate font-mono text-[11px] text-mute">{(p.analysis as any)?.websiteUrl} · {timeAgo(p.updated_at || p.created_at)}</div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
