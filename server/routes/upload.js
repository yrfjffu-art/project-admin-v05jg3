import supabase from '../../api/db-client.js';
import { cors, getUser } from '../lib/auth.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { fileName } = req.body || {};
    if (!fileName || !/\.zip$/i.test(fileName)) return res.status(400).json({ error: 'A .zip file is required' });
    const safe = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    const path = `${user.id}/${Date.now()}-${safe}`;

    const { data, error } = await supabase.storage.from('project-zips').createSignedUploadUrl(path);
    if (error) throw error;
    return res.status(200).json({ signedUrl: data.signedUrl, path });
  } catch (err) {
    console.error('API error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
