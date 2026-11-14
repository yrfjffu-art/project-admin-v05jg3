import supabase from '../../api/db-client.js';
import { cors, getUser } from '../lib/auth.js';
import { getConn, gh } from '../lib/github.js';
import { dispatchBuild } from '../services/buildService.js';
import { baseUrl } from '../lib/config.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    if (req.method === 'GET') {
      const { id, project_id, status, limit } = req.query;
      if (id) {
        const { data, error } = await supabase
          .from('builds').select('*, projects(name, package_name, zip_name)')
          .eq('id', id).eq('user_id', user.id).maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Build not found' });
        return res.status(200).json(data);
      }
      let q = supabase
        .from('builds')
        .select('id, project_id, status, build_type, module, gradle_task, jdk_version, sdk_platform, build_tools, gradle_version, agent_id, agent_name, apk_url, apk_size, error, started_at, finished_at, created_at, projects(name, package_name)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(Math.min(Number(limit) || 100, 300));
      if (project_id) q = q.eq('project_id', project_id);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      if (!b.project_id) return res.status(400).json({ error: 'project_id is required' });
      const { data: project } = await supabase
        .from('projects').select('id, name, zip_url, zip_path').eq('id', b.project_id).eq('user_id', user.id).maybeSingle();
      if (!project) return res.status(404).json({ error: 'Project not found' });
      if (!project.zip_url) return res.status(400).json({ error: 'Project has no source zip' });
      const buildType = b.build_type === 'release' ? 'release' : 'debug';
      if (!b.gradle_task || !String(b.gradle_task).trim()) return res.status(400).json({ error: 'Gradle task is required' });
      if (!b.jdk_version) return res.status(400).json({ error: 'Select a JDK version' });

      const wantCloud = b.runner === 'cloud';
      const conn = wantCloud ? await getConn(user.id) : null;
      if (wantCloud && !conn) return res.status(400).json({ error: 'Connect GitHub on the Build Servers page to use cloud builds.' });
      const { data, error } = await supabase
        .from('builds')
        .insert({
          project_id: b.project_id,
          user_id: user.id,
          status: 'queued',
          build_type: buildType,
          module: b.module ?? 'app',
          gradle_task: String(b.gradle_task).trim(),
          jdk_version: b.jdk_version,
          sdk_platform: b.sdk_platform || null,
          build_tools: b.build_tools || null,
          gradle_version: b.gradle_version || null,
          extra_args: b.extra_args || null,
          ...(wantCloud ? { agent_id: -1, agent_name: 'GitHub Actions (cloud)' } : {}),
          logs: wantCloud
            ? `[forge] Cloud build requested at ${new Date().toISOString()}\n[forge] Triggering GitHub Actions in ${conn.repo} (ubuntu, JDK ${b.jdk_version}, SDK ${b.sdk_platform || 'auto'})…\n`
            : `[forge] Build queued at ${new Date().toISOString()}\n[forge] Waiting for an online build agent to claim this job…\n`,
        })
        .select()
        .single();
      if (error) throw error;
      await supabase.from('build_meta').insert({ build_id: data.id, user_id: user.id, source: 'zip', package_name: null, notified_status: 'queued' });
      if (wantCloud) {
        // Only triggers the workflow; status updates arrive via /api/hooks/github callbacks.
        await dispatchBuild(data, project, { conn, callbackUrl: `${baseUrl(req)}/api/hooks/github` }).catch(() => {});
      }
      return res.status(201).json(data);
    }

    if (req.method === 'PUT') {
      const { id, action } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id is required' });
      const { data: build } = await supabase
        .from('builds').select('*').eq('id', id).eq('user_id', user.id).maybeSingle();
      if (!build) return res.status(404).json({ error: 'Build not found' });
      if (action === 'cancel') {
        if (!['queued', 'running'].includes(build.status)) return res.status(400).json({ error: `Cannot cancel a ${build.status} build` });
        if (build.agent_id === -1) {
          const conn = await getConn(user.id);
          const { data: cr } = await supabase.from('cloud_runs').select('run_id').eq('build_id', id).maybeSingle();
          if (conn && cr?.run_id) await gh(conn.token, `/repos/${conn.repo}/actions/runs/${cr.run_id}/cancel`, { method: 'POST' }).catch(() => {});
        }
        const { data, error } = await supabase
          .from('builds')
          .update({
            status: 'cancelled',
            finished_at: new Date().toISOString(),
            logs: (build.logs || '') + `[forge] Cancelled by user at ${new Date().toISOString()}\n`,
          })
          .eq('id', id).select().single();
        if (error) throw error;
        return res.status(200).json(data);
      }
      return res.status(400).json({ error: 'Unknown action' });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id is required' });
      const { data: build } = await supabase
        .from('builds').select('id, apk_url, user_id').eq('id', id).eq('user_id', user.id).maybeSingle();
      if (!build) return res.status(404).json({ error: 'Build not found' });
      if (build.apk_url) {
        const marker = '/apks/';
        const idx = build.apk_url.indexOf(marker);
        if (idx > -1) await supabase.storage.from('apks').remove([decodeURIComponent(build.apk_url.slice(idx + marker.length))]);
      }
      const { error } = await supabase.from('builds').delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('API error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
