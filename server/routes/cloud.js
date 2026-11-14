import supabase from '../../api/db-client.js';
import { cors, getUser } from '../lib/auth.js';
import { writeSecret, deleteSecret } from '../lib/vault.js';
import { gh, getConn, syncCloud } from '../lib/github.js';
import { notifyBuild } from '../services/notify.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    if (req.method === 'GET') {
      const conn = await getConn(user.id);
      return res.status(200).json(conn ? { connected: true, login: conn.login, repo: conn.repo } : { connected: false });
    }

    if (req.method === 'POST') {
      const { action } = req.body || {};

      if (action === 'connect') {
        const token = String(req.body.token || '').trim();
        if (!token) return res.status(400).json({ error: 'Paste a GitHub token' });
        let me;
        try { me = await gh(token, '/user'); } catch { return res.status(400).json({ error: 'GitHub rejected this token. Create a classic token with "repo" and "workflow" scopes.' }); }
        const repoName = 'apk-forge-builds';
        const repo = `${me.login}/${repoName}`;
        try { await gh(token, `/repos/${repo}`); }
        catch (e) {
          if (e.status !== 404) throw e;
          await gh(token, '/user/repos', { method: 'POST', body: JSON.stringify({ name: repoName, private: true, auto_init: true, description: 'Build workspace for APK Forge (managed automatically)' }) });
          await new Promise((r) => setTimeout(r, 1500));
        }
        await writeSecret(`github/${user.id}.json`, { token, login: me.login, repo });
        return res.status(200).json({ connected: true, login: me.login, repo });
      }

      if (action === 'disconnect') {
        await deleteSecret(`github/${user.id}.json`);
        return res.status(200).json({ connected: false });
      }

      if (action === 'sync') {
        const conn = await getConn(user.id);
        if (!conn) return res.status(200).json({ synced: 0 });
        let q = supabase.from('builds').select('*').eq('user_id', user.id).eq('agent_id', -1).in('status', ['queued', 'running']);
        if (req.body.build_id) q = q.eq('id', req.body.build_id);
        const { data: builds } = await q.limit(5);
        const out = [];
        for (const b of builds || []) {
          // Callbacks from the runner are the primary channel; polling GitHub is only a fallback
          // for runs that never reported back (or builds created before callbacks existed).
          const { data: meta } = await supabase.from('build_meta').select('last_callback_at').eq('build_id', b.id).maybeSingle();
          const age = Date.now() - new Date(b.created_at).getTime();
          if (meta?.last_callback_at ? age < 60 * 60_000 : age < 90_000) { out.push(b); continue; }
          try { const r = await syncCloud(b, conn); out.push(r); if (r.status !== b.status) notifyBuild(b.id).catch(() => {}); }
          catch (e) { out.push({ id: b.id, syncError: e.message }); }
        }
        return res.status(200).json({ synced: out.length, builds: out.map((b) => ({ id: b.id, status: b.status, syncError: b.syncError })) });
      }
      return res.status(400).json({ error: 'Unknown action' });
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Cloud API error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
