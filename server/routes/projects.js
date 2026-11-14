import supabase from '../../api/db-client.js';
import { cors, getUser } from '../lib/auth.js';

const BUCKET = 'project-zips';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    if (req.method === 'GET') {
      const { id } = req.query;
      if (id) {
        const { data, error } = await supabase
          .from('projects').select('*').eq('id', id).eq('user_id', user.id).maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Project not found' });
        return res.status(200).json(data);
      }
      const { data, error } = await supabase
        .from('projects').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const { name, package_name, description, zip_path, zip_name, zip_size, analysis } = req.body || {};
      if (!name || !String(name).trim()) return res.status(400).json({ error: 'Project name is required' });
      if (!zip_path) return res.status(400).json({ error: 'Source zip is required' });
      if (!String(zip_path).startsWith(user.id + '/')) return res.status(400).json({ error: 'Invalid upload path' });
      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(zip_path);
      const { data, error } = await supabase
        .from('projects')
        .insert({
          user_id: user.id,
          name: String(name).trim(),
          package_name: package_name || null,
          description: description || null,
          zip_path,
          zip_name: zip_name || null,
          zip_size: zip_size || null,
          zip_url: urlData.publicUrl,
          analysis: analysis || null,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw error;
      return res.status(201).json(data);
    }

    if (req.method === 'PUT') {
      const { id, name, package_name, description, zip_path, zip_name, zip_size, analysis } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id is required' });
      const { data: existing } = await supabase
        .from('projects').select('*').eq('id', id).eq('user_id', user.id).maybeSingle();
      if (!existing) return res.status(404).json({ error: 'Project not found' });
      const patch = { updated_at: new Date().toISOString() };
      if (name !== undefined) {
        if (!String(name).trim()) return res.status(400).json({ error: 'Project name is required' });
        patch.name = String(name).trim();
      }
      if (package_name !== undefined) patch.package_name = package_name || null;
      if (description !== undefined) patch.description = description || null;
      if (zip_path) {
        if (!String(zip_path).startsWith(user.id + '/')) return res.status(400).json({ error: 'Invalid upload path' });
        patch.zip_path = zip_path;
        patch.zip_name = zip_name || null;
        patch.zip_size = zip_size || null;
        patch.zip_url = supabase.storage.from(BUCKET).getPublicUrl(zip_path).data.publicUrl;
        if (analysis !== undefined) patch.analysis = analysis;
        if (existing.zip_path && existing.zip_path !== zip_path) {
          await supabase.storage.from(BUCKET).remove([existing.zip_path]);
        }
      }
      const { data, error } = await supabase
        .from('projects').update(patch).eq('id', id).eq('user_id', user.id).select().single();
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id is required' });
      const { data: existing } = await supabase
        .from('projects').select('zip_path').eq('id', id).eq('user_id', user.id).maybeSingle();
      if (!existing) return res.status(404).json({ error: 'Project not found' });
      if (existing.zip_path) await supabase.storage.from(BUCKET).remove([existing.zip_path]);
      const { error } = await supabase.from('projects').delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('API error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
