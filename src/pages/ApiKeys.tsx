import { useEffect, useState } from 'react';
import { KeyRound, Plus, Loader2, Copy, Check, Trash2, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { PageHeader, Spinner, ErrorBox, Empty } from '../components/ui';
import { timeAgo } from '../lib/format';

interface ApiKey { id: number; name: string; prefix: string; rate_per_hour: number; monthly_quota: number; last_used_at: string | null; revoked_at: string | null; created_at: string; used_this_month: number }
interface NewKey extends Omit<ApiKey, 'used_this_month' | 'last_used_at' | 'revoked_at'> { key: string; webhook_secret: string }

function CopyField({ label, value }: { label: string; value: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div>
      <div className="label">{label}</div>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2">
        <code className="flex-1 break-all font-mono text-xs">{value}</code>
        <button onClick={() => { navigator.clipboard.writeText(value); setOk(true); setTimeout(() => setOk(false), 1500); }} className="text-mute hover:text-droid" aria-label={`Copy ${label}`}>
          {ok ? <Check className="h-4 w-4 text-droid" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

export default function ApiKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [nameErr, setNameErr] = useState('');
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<NewKey | null>(null);
  const origin = window.location.origin;

  const load = async () => {
    try { setError(''); setKeys(await api<ApiKey[]>('/api/api-keys')); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    setNameErr('');
    if (!name.trim()) return setNameErr('Give the key a name, e.g. "my-game-server"');
    setCreating(true);
    try { setFresh(await api<NewKey>('/api/api-keys', { method: 'POST', body: { name: name.trim() } })); setName(''); load(); }
    catch (e: any) { setNameErr(e.message); }
    finally { setCreating(false); }
  };
  const revoke = async (k: ApiKey) => {
    if (!confirm(`Revoke "${k.name}"? Apps using it will stop working immediately.`)) return;
    try { await api(`/api/api-keys/${k.id}`, { method: 'DELETE' }); load(); }
    catch (e: any) { setError(e.message); }
  };

  const curlBuild = `curl -X POST ${origin}/api/v1/build \\
  -H "Authorization: Bearer $WEB2APK_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://example.com","app_name":"My App","package_name":"com.example.myapp","webhook_url":"https://your-server.com/web2apk-hook"}'`;
  const curlStatus = `curl ${origin}/api/v1/build/123 -H "Authorization: Bearer $WEB2APK_KEY"`;
  const verify = `// Node: verify the webhook (header X-Web2APK-Signature: t=<unix>,v1=<hex>)
const [t, v1] = sig.split(',').map((p) => p.split('=')[1]);
const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(\`\${t}.\${rawBody}\`).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1)) && Math.abs(Date.now()/1000 - t) < 300;`;

  return (
    <div>
      <PageHeader kicker="// public build api" title="API Keys" />

      {fresh && (
        <div className="card mb-6 space-y-3 border-amber/60 p-5">
          <div className="flex items-center gap-2 font-display font-semibold text-amber"><AlertTriangle className="h-4 w-4" /> Copy these now — they will never be shown again</div>
          <CopyField label="API key" value={fresh.key} />
          <CopyField label="Webhook signing secret" value={fresh.webhook_secret} />
          <button onClick={() => setFresh(null)} className="btn btn-ghost">I saved them</button>
        </div>
      )}

      <div className="card mb-6 flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="label">New key name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} placeholder="my-game-server" maxLength={60} />
          {nameErr && <div className="mt-1 text-xs text-danger">{nameErr}</div>}
        </div>
        <button onClick={create} disabled={creating} className="btn btn-primary">{creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Generate key</button>
      </div>

      {error && <div className="mb-4"><ErrorBox message={error} onRetry={load} /></div>}
      {loading ? <Spinner /> : keys.length === 0 ? (
        <Empty icon={<KeyRound />} title="No API keys" text="Generate a key so your website, game or bot can build APKs through the API." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wider text-mute">
              <th className="px-4 py-3">Name</th><th className="px-4 py-3">Key</th><th className="px-4 py-3">Usage (month)</th><th className="px-4 py-3">Limit</th><th className="px-4 py-3">Last used</th><th className="px-4 py-3" />
            </tr></thead>
            <tbody className="divide-y divide-line">
              {keys.map((k) => (
                <tr key={k.id} className={k.revoked_at ? 'opacity-50' : ''}>
                  <td className="px-4 py-3">{k.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{k.prefix}…</td>
                  <td className="px-4 py-3 font-mono text-xs">{k.used_this_month} / {k.monthly_quota}</td>
                  <td className="px-4 py-3 font-mono text-xs">{k.rate_per_hour}/hour</td>
                  <td className="px-4 py-3 text-xs text-mute">{timeAgo(k.last_used_at)}</td>
                  <td className="px-4 py-3 text-right">{k.revoked_at ? <span className="text-xs text-mute">revoked</span> : <button onClick={() => revoke(k)} className="inline-flex items-center gap-1 text-xs text-mute hover:text-danger"><Trash2 className="h-3.5 w-3.5" /> Revoke</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-8 space-y-4">
        <h2 className="font-display text-lg font-semibold">Using the API</h2>
        <p className="text-sm text-mute">Call it from your server (not from browser code — that would expose the key). Status values: <span className="font-mono text-ink">queued → building → success | failed</span>.</p>
        <div className="term p-4"><div className="mb-2 font-mono text-[11px] uppercase text-mute">start a build → 202 {'{ id, status_url }'}</div><pre className="overflow-x-auto font-mono text-xs leading-6 text-ink/90">{curlBuild}</pre></div>
        <div className="term p-4"><div className="mb-2 font-mono text-[11px] uppercase text-mute">poll status → status, log_tail, apk_url</div><pre className="overflow-x-auto font-mono text-xs leading-6 text-ink/90">{curlStatus}</pre></div>
        <div className="term p-4"><div className="mb-2 font-mono text-[11px] uppercase text-mute">webhook (optional) — POSTed when the build finishes</div><pre className="overflow-x-auto font-mono text-xs leading-6 text-ink/90">{verify}</pre></div>
      </div>
    </div>
  );
}
