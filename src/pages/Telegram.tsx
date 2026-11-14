import { useEffect, useState } from 'react';
import { Send, Loader2, Trash2, RefreshCw, Link2, ShieldCheck, Globe2 } from 'lucide-react';
import { api } from '../lib/api';
import { PageHeader, Spinner, ErrorBox, Empty } from '../components/ui';
import { timeAgo } from '../lib/format';

interface Bot { id: number; bot_username: string | null; allow_public: boolean; enabled: boolean; disabled_by_admin: boolean; webhook_ok: boolean; owner_linked: boolean; link_url: string | null; last_update_at: string | null; created_at: string }

export default function Telegram() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [token, setToken] = useState('');
  const [tokErr, setTokErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<number | null>(null);

  const load = async () => {
    try { setError(''); setBots(await api<Bot[]>('/api/telegram-bots')); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const connect = async () => {
    setTokErr('');
    if (!/^\d{5,15}:[A-Za-z0-9_-]{30,60}$/.test(token.trim())) return setTokErr('Paste the token from @BotFather (looks like 123456789:AA…)');
    setBusy(true);
    try { await api('/api/telegram-bots', { method: 'POST', body: { token: token.trim() } }); setToken(''); load(); }
    catch (e: any) { setTokErr(e.message); load(); }
    finally { setBusy(false); }
  };
  const update = async (b: Bot, body: Record<string, unknown>) => {
    setRowBusy(b.id);
    try { await api(`/api/telegram-bots/${b.id}`, { method: 'PUT', body }); load(); }
    catch (e: any) { setError(e.message); }
    finally { setRowBusy(null); }
  };
  const remove = async (b: Bot) => {
    if (!confirm(`Disconnect @${b.bot_username}? Its webhook will be removed.`)) return;
    try { await api(`/api/telegram-bots/${b.id}`, { method: 'DELETE' }); load(); }
    catch (e: any) { setError(e.message); }
  };

  return (
    <div>
      <PageHeader kicker="// chat ops" title="Telegram bot" />
      <div className="mb-8 grid gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="font-display font-semibold">Connect your bot</div>
          <ol className="mt-2 space-y-1 text-sm text-mute">
            <li><span className="font-mono text-droid">1.</span> In Telegram open <span className="text-ink">@BotFather</span> → <span className="font-mono text-ink">/newbot</span> and copy the token.</li>
            <li><span className="font-mono text-droid">2.</span> Paste it here. It is checked with <span className="font-mono">getMe</span>, encrypted, and never shown again.</li>
            <li><span className="font-mono text-droid">3.</span> Tap <b className="text-ink">Link my chat</b> so the bot knows you are its owner.</li>
          </ol>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input className="input font-mono" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456789:AAH…" autoComplete="off" />
            <button onClick={connect} disabled={busy} className="btn btn-primary">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Connect</button>
          </div>
          {tokErr && <div className="mt-2 text-sm text-danger">{tokErr}</div>}
        </div>
        <div className="card p-5">
          <div className="font-display font-semibold">Commands</div>
          <ul className="mt-2 space-y-1.5 font-mono text-xs">
            <li><span className="text-droid">/start</span> <span className="text-mute">help</span></li>
            <li><span className="text-droid">/build</span> https://site.com</li>
            <li><span className="text-droid">/status</span> 123</li>
            <li><span className="text-droid">/mybuilds</span></li>
          </ul>
          <p className="mt-3 text-xs text-mute">The finished APK is sent straight into the chat.</p>
        </div>
      </div>

      {error && <div className="mb-4"><ErrorBox message={error} onRetry={load} /></div>}
      {loading ? <Spinner /> : bots.length === 0 ? (
        <Empty icon={<Send />} title="No bot connected" text="Connect a Telegram bot to build APKs from chat with /build <url>." />
      ) : (
        <div className="space-y-4">
          {bots.map((b) => (
            <div key={b.id} className="card p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex flex-1 items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-lg bg-sky/10 text-sky"><Send className="h-5 w-5" /></div>
                  <div>
                    <div className="font-display font-semibold">@{b.bot_username}</div>
                    <div className="font-mono text-xs text-mute">
                      {b.disabled_by_admin ? <span className="text-danger">disabled by admin</span> : b.webhook_ok ? <span className="text-droid">webhook active</span> : <span className="text-amber">webhook not set</span>}
                      {' · '}last message {timeAgo(b.last_update_at)}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {b.link_url && <a href={b.link_url} target="_blank" rel="noreferrer" className="btn btn-primary !py-1.5 text-xs"><Link2 className="h-3.5 w-3.5" /> Link my chat</a>}
                  {b.owner_linked && <span className="chip text-droid"><ShieldCheck className="mr-1 h-3 w-3" /> owner linked</span>}
                  <button onClick={() => update(b, { allow_public: !b.allow_public })} disabled={rowBusy === b.id} className="btn btn-ghost !py-1.5 text-xs" title="Who may use /build">
                    <Globe2 className="h-3.5 w-3.5" /> {b.allow_public ? 'Public: anyone' : 'Private: owner only'}
                  </button>
                  <button onClick={() => update(b, { resync: true })} disabled={rowBusy === b.id} className="rounded p-2 text-mute hover:text-amber" title="Re-install webhook">{rowBusy === b.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}</button>
                  <button onClick={() => remove(b)} className="rounded p-2 text-mute hover:text-danger" title="Disconnect"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
              {b.allow_public && <p className="mt-3 text-xs text-amber">Public mode: anyone who finds the bot can start builds (limited per chat per hour) using your GitHub build minutes.</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
