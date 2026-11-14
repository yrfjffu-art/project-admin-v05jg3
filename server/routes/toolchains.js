import supabase from '../../api/db-client.js';
import { cors, getUser } from '../lib/auth.js';

const KINDS = ['jdk', 'android-sdk', 'build-tools', 'gradle', 'ndk'];

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('toolchains').select('*').order('kind').order('version', { ascending: false });
      if (error) throw error;
      return res.status(200).json(data);
    }

    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    if (req.method === 'POST') {
      const { kind, version, label, path, notes } = req.body || {};
      if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Invalid toolchain kind' });
      if (!version || !String(version).trim()) return res.status(400).json({ error: 'Version is required' });
      const { data: dup } = await supabase.from('toolchains').select('id').eq('kind', kind).eq('version', String(version).trim()).maybeSingle();
      if (dup) return res.status(400).json({ error: `${kind} ${version} already exists` });
      const { data, error } = await supabase
        .from('toolchains')
        .insert({ kind, version: String(version).trim(), label: label || null, path: path || null, notes: notes || null, enabled: true, is_default: false })
        .select().single();
      if (error) throw error;
      return res.status(201).json(data);
    }

    if (req.method === 'PUT') {
      const { id, ...rest } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id is required' });
      const { data: tc } = await supabase.from('toolchains').select('*').eq('id', id).maybeSingle();
      if (!tc) return res.status(404).json({ error: 'Toolchain not found' });
      const patch = {};
      for (const k of ['label', 'path', 'notes', 'enabled', 'version']) if (rest[k] !== undefined) patch[k] = rest[k];
      if (rest.is_default === true) {
        await supabase.from('toolchains').update({ is_default: false }).eq('kind', tc.kind);
        patch.is_default = true;
        patch.enabled = true;
      }
      const { data, error } = await supabase.from('toolchains').update(patch).eq('id', id).select().single();
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id is required' });
      const { error } = await supabase.from('toolchains').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('API error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
