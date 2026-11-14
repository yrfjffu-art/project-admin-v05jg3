import crypto from 'node:crypto';
import supabase from '../../api/db-client.js';
import { cors, getUser } from '../lib/auth.js';
import { readSecret, writeSecret, deleteSecret, hashToken } from '../lib/vault.js';

const legacySha = (t) => 'sha256:' + crypto.createHash('sha256').update(String(t)).digest('hex');
const newToken = () => 'fa_' + crypto.randomBytes(24).toString('hex');
async function stash(agent, token) {
  await writeSecret(`agents/${agent.id}.json`, { token });
  await supabase.from('agents').update({ token: hashToken(token) }).eq('id', agent.id);
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('agents').select('*').eq('user_id', user.id).order('created_at', { ascending: true });
      if (error) throw error;
      if (!data.length) {
        const { data: created, error: cErr } = await supabase
          .from('agents')
          .insert({ user_id: user.id, name: 'my-build-server', token: 'pending', status: 'never-connected' })
          .select();
        if (cErr) throw cErr;
        await stash(created[0], newToken());
        data.push(...created);
      }
      for (const a of data) {
        // Never trust plaintext/legacy rows: only tokens whose plaintext is in the private vault are valid.
        if (!String(a.token).startsWith('h1:')) {
          const v = (await readSecret(`agents/${a.id}.json`))?.token;
          if (v && String(a.token) === legacySha(v)) await stash(a, v);
          else { await supabase.from('agents').update({ token: 'revoked' }).eq('id', a.id); a.token = ''; continue; }
        }
        a.token = (await readSecret(`agents/${a.id}.json`))?.token || '';
      }
      const now = Date.now();
      return res.status(200).json(
        data.map((a) => ({ ...a, online: !!a.last_seen && now - new Date(a.last_seen).getTime() < 45000 }))
      );
    }

    if (req.method === 'POST') {
      const { name } = req.body || {};
      if (!name || !String(name).trim()) return res.status(400).json({ error: 'Agent name is required' });
      const token = newToken();
      const { data, error } = await supabase
        .from('agents')
        .insert({ user_id: user.id, name: String(name).trim().slice(0, 60), token: 'pending', status: 'never-connected' })
        .select().single();
      if (error) throw error;
      await stash(data, token);
      return res.status(201).json({ ...data, token });
    }

    if (req.method === 'PUT') {
      const { id, name, rotate } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id is required' });
      const patch = {};
      if (name) patch.name = String(name).trim().slice(0, 60);
      const { data, error } = await supabase
        .from('agents').update(patch).eq('id', id).eq('user_id', user.id).select().single();
      if (error) throw error;
      if (rotate) { const t = newToken(); await stash(data, t); return res.status(200).json({ ...data, token: t }); }
      return res.status(200).json({ ...data, token: undefined });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id is required' });
      const { error } = await supabase.from('agents').delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
      await deleteSecret(`agents/${id}.json`);
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('API error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
