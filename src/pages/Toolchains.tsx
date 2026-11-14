import { useEffect, useState } from 'react';
import { Plus, Star, Trash2, Loader2, Coffee, Smartphone, Hammer, Layers, Cpu } from 'lucide-react';
import { api } from '../lib/api';
import type { Toolchain, ToolKind } from '../lib/types';
import { PageHeader, Spinner, ErrorBox } from '../components/ui';
import { KIND_LABEL } from '../lib/format';

const KINDS: { kind: ToolKind; icon: typeof Coffee; hint: string; pathHint: string }[] = [
  { kind: 'jdk', icon: Coffee, hint: 'Java toolchains used to run Gradle. AGP 8.x needs JDK 17+.', pathHint: '/usr/lib/jvm/temurin-17-jdk-amd64' },
  { kind: 'android-sdk', icon: Smartphone, hint: 'compileSdk platform levels. Path = Android SDK root (ANDROID_HOME).', pathHint: '/opt/android-sdk' },
  { kind: 'build-tools', icon: Hammer, hint: 'aapt2, d8, apksigner and zipalign versions.', pathHint: '' },
  { kind: 'gradle', icon: Layers, hint: 'Used only when a project has no gradlew wrapper.', pathHint: '/opt/gradle/gradle-8.11.1' },
  { kind: 'ndk', icon: Cpu, hint: 'Native C/C++ toolchain for projects with JNI code.', pathHint: '/opt/android-sdk/ndk/27.2.12479018' },
];

export default function Toolchains() {
  const [tools, setTools] = useState<Toolchain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState<ToolKind | null>(null);
  const [form, setForm] = useState({ version: '', label: '', path: '', notes: '' });
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [editPath, setEditPath] = useState<{ id: number; value: string } | null>(null);

  const fetchTools = async () => {
    try { setError(''); setTools(await api<Toolchain[]>('/api/toolchains')); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchTools(); }, []);

  const add = async () => {
    setFormErr('');
    if (!form.version.trim()) return setFormErr('Version is required.');
    if (!/^[\w.\-+]+$/.test(form.version.trim())) return setFormErr('Version may contain letters, digits, dots and dashes only.');
    setSaving(true);
    try {
      await api('/api/toolchains', { method: 'POST', body: { kind: adding, ...form } });
      setAdding(null); setForm({ version: '', label: '', path: '', notes: '' });
      fetchTools();
    } catch (e: any) { setFormErr(e.message); }
    finally { setSaving(false); }
  };
  const update = async (id: number, patch: Partial<Toolchain>) => {
    try { await api('/api/toolchains', { method: 'PUT', body: { id, ...patch } }); fetchTools(); }
    catch (e: any) { setError(e.message); }
  };
  const remove = async (t: Toolchain) => {
    if (!confirm(`Remove ${KIND_LABEL[t.kind]} ${t.version}?`)) return;
    try { await api('/api/toolchains', { method: 'DELETE', body: { id: t.id } }); fetchTools(); }
    catch (e: any) { setError(e.message); }
  };

  return (
    <div>
      <PageHeader kicker="// sdk · jdk · gradle" title="Toolchains" />
      <p className="-mt-4 mb-8 max-w-2xl text-sm text-mute">Manage the versions offered in build configs. Set an install <span className="font-mono text-ink">path</span> and agents will export it (JAVA_HOME, ANDROID_HOME, Gradle bin) when a build selects that version.</p>
      {error && <div className="mb-6"><ErrorBox message={error} onRetry={fetchTools} /></div>}
      {loading ? <Spinner /> : (
        <div className="space-y-6">
          {KINDS.map(({ kind, icon: Icon, hint, pathHint }) => {
            const list = tools.filter((t) => t.kind === kind);
            return (
              <section key={kind} className="card">
                <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="grid h-9 w-9 place-items-center rounded-lg bg-droid/10 text-droid"><Icon className="h-4 w-4" /></div>
                    <div><div className="font-display font-semibold">{KIND_LABEL[kind]}</div><div className="text-xs text-mute">{hint}</div></div>
                  </div>
                  <button onClick={() => { setAdding(adding === kind ? null : kind); setFormErr(''); setForm({ version: '', label: '', path: '', notes: '' }); }} className="btn btn-ghost self-start sm:self-auto"><Plus className="h-4 w-4" /> Add version</button>
                </div>

                {adding === kind && (
                  <div className="grid gap-3 border-b border-line bg-panel2/50 px-5 py-4 sm:grid-cols-4">
                    <input className="input font-mono" placeholder="Version *" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
                    <input className="input" placeholder="Label (e.g. Temurin 17)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
                    <input className="input font-mono sm:col-span-2" placeholder={pathHint ? `Path, e.g. ${pathHint}` : 'Path (optional)'} value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} />
                    <input className="input sm:col-span-3" placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                    <button onClick={add} disabled={saving} className="btn btn-primary">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save</button>
                    {formErr && <div className="text-sm text-danger sm:col-span-4">{formErr}</div>}
                  </div>
                )}

                {list.length === 0 ? <div className="px-5 py-6 text-sm text-mute">No versions configured.</div> : (
                  <div className="divide-y divide-line">
                    {list.map((t) => (
                      <div key={t.id} className={`flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center ${!t.enabled ? 'opacity-50' : ''}`}>
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <span className="min-w-16 rounded-md border border-line bg-panel2 px-2 py-1 text-center font-mono text-sm">{t.version}</span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-sm">{t.label || `${KIND_LABEL[kind]} ${t.version}`}{t.is_default && <span className="chip text-droid">default</span>}</div>
                            {editPath?.id === t.id ? (
                              <div className="mt-1 flex gap-2">
                                <input autoFocus className="input !py-1 font-mono text-xs" value={editPath.value} onChange={(e) => setEditPath({ id: t.id, value: e.target.value })}
                                  onKeyDown={(e) => { if (e.key === 'Enter') { update(t.id, { path: editPath.value || null }); setEditPath(null); } if (e.key === 'Escape') setEditPath(null); }} />
                                <button onClick={() => { update(t.id, { path: editPath.value || null }); setEditPath(null); }} className="text-xs text-droid">save</button>
                              </div>
                            ) : (
                              <button onClick={() => setEditPath({ id: t.id, value: t.path || '' })} className="truncate font-mono text-xs text-mute hover:text-ink">{t.path || '+ set install path'}</button>
                            )}
                            {t.notes && <div className="text-xs text-mute">{t.notes}</div>}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <label className="flex cursor-pointer items-center gap-2 text-xs text-mute">
                            <span className={`relative h-5 w-9 rounded-full transition ${t.enabled ? 'bg-droid' : 'bg-line'}`}>
                              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-bg transition ${t.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                            </span>
                            <input type="checkbox" className="hidden" checked={t.enabled} onChange={() => update(t.id, { enabled: !t.enabled })} />
                            {t.enabled ? 'enabled' : 'disabled'}
                          </label>
                          <button onClick={() => update(t.id, { is_default: true })} disabled={t.is_default} title="Make default" className={`rounded p-1.5 ${t.is_default ? 'text-amber' : 'text-mute hover:text-amber'}`}><Star className={`h-4 w-4 ${t.is_default ? 'fill-current' : ''}`} /></button>
                          <button onClick={() => remove(t)} title="Remove" className="rounded p-1.5 text-mute hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
