import supabase from '../../api/db-client.js';
import { cors } from '../lib/auth.js';
import crypto from 'node:crypto';
import { hashToken, readSecret } from '../lib/vault.js';
import { notifyBuild } from '../services/notify.js';
import { safeEqual } from '../lib/crypto.js';

// Build-agent protocol endpoint. Agents authenticate with X-Agent-Token.
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const token = req.headers['x-agent-token'] || req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Missing agent token' });
    if (typeof token !== 'string' || token.length > 200) return res.status(401).json({ error: 'Invalid agent token' });
    let { data: agent } = await supabase.from('agents').select('*').eq('token', hashToken(token)).maybeSingle();
    if (!agent) {
      // Legacy unpeppered hash: accept only if the plaintext in the private vault matches, then upgrade.
      const legacy = 'sha256:' + crypto.createHash('sha256').update(token).digest('hex');
      const { data: old } = await supabase.from('agents').select('*').eq('token', legacy).maybeSingle();
      if (old && safeEqual((await readSecret(`agents/${old.id}.json`))?.token, token)) {
        await supabase.from('agents').update({ token: hashToken(token) }).eq('id', old.id);
        agent = old;
      }
    }
    if (!agent) return res.status(401).json({ error: 'Invalid agent token' });

    const body = req.body || {};
    const now = new Date().toISOString();

    const ownBuild = async (id) => {
      const { data } = await supabase.from('builds').select('*').eq('id', id).eq('agent_id', agent.id).maybeSingle();
      return data;
    };

    switch (body.action) {
      case 'heartbeat': {
        await supabase.from('agents').update({
          last_seen: now,
          os: body.os || agent.os,
          status: body.busy ? 'busy' : 'idle',
        }).eq('id', agent.id);
        return res.status(200).json({ ok: true, name: agent.name });
      }

      case 'claim': {
        await supabase.from('agents').update({ last_seen: now, os: body.os || agent.os, status: 'idle' }).eq('id', agent.id);
        const { data: queued } = await supabase
          .from('builds').select('*').eq('user_id', agent.user_id).eq('status', 'queued').or('agent_id.is.null,agent_id.neq.-1')
          .order('created_at', { ascending: true }).limit(1);
        if (!queued || !queued.length) return res.status(200).json({ build: null });
        const next = queued[0];
        const { data: claimed } = await supabase
          .from('builds')
          .update({
            status: 'running',
            agent_id: agent.id,
            agent_name: agent.name,
            started_at: now,
            logs: (next.logs || '') + `[forge] Claimed by agent "${agent.name}" (${body.os || agent.os || 'unknown os'})\n`,
          })
          .eq('id', next.id).eq('status', 'queued')
          .select().maybeSingle();
        if (!claimed) return res.status(200).json({ build: null });

        const { data: project } = await supabase
          .from('projects').select('id, name, package_name, zip_url, zip_name').eq('id', claimed.project_id).maybeSingle();
        const { data: tcs } = await supabase.from('toolchains').select('*').eq('enabled', true);
        const pick = (kind, version) => (tcs || []).find((t) => t.kind === kind && t.version === version)?.path || null;
        const sdkRoot = (tcs || []).find((t) => t.kind === 'android-sdk' && t.version === claimed.sdk_platform)?.path
          || (tcs || []).find((t) => t.kind === 'android-sdk' && t.is_default)?.path || null;

        await supabase.from('agents').update({ status: 'busy', current_build_id: claimed.id }).eq('id', agent.id);
        notifyBuild(claimed.id).catch(() => {});
        return res.status(200).json({
          build: {
            ...claimed,
            logs: undefined,
            project,
            paths: {
              jdk: pick('jdk', claimed.jdk_version),
              gradle: pick('gradle', claimed.gradle_version),
              sdk: sdkRoot,
            },
          },
        });
      }

      case 'log': {
        const build = await ownBuild(body.build_id);
        if (!build) return res.status(404).json({ error: 'Build not found for this agent' });
        const merged = ((build.logs || '') + String(body.chunk || '')).slice(-400000);
        await supabase.from('builds').update({ logs: merged }).eq('id', build.id);
        await supabase.from('agents').update({ last_seen: now, status: 'busy' }).eq('id', agent.id);
        return res.status(200).json({ status: build.status });
      }

      case 'upload-url': {
        const build = await ownBuild(body.build_id);
        if (!build) return res.status(404).json({ error: 'Build not found for this agent' });
        const safe = String(body.file_name || 'app.apk').replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${agent.user_id}/build-${build.id}/${Date.now()}-${safe}`;
        const { data, error } = await supabase.storage.from('apks').createSignedUploadUrl(path);
        if (error) throw error;
        return res.status(200).json({ signedUrl: data.signedUrl, path });
      }

      case 'complete': {
        const build = await ownBuild(body.build_id);
        if (!build) return res.status(404).json({ error: 'Build not found for this agent' });
        const patch = { finished_at: now };
        if (build.status === 'running') {
          patch.status = ['success', 'failed', 'cancelled'].includes(body.status) ? body.status : 'failed';
        }
        if (body.apk_path) {
          if (!String(body.apk_path).startsWith(`${agent.user_id}/build-${build.id}/`) || String(body.apk_path).includes('..')) {
            return res.status(400).json({ error: 'Invalid apk_path' });
          }
          patch.apk_url = supabase.storage.from('apks').getPublicUrl(body.apk_path).data.publicUrl;
          patch.apk_size = body.apk_size || null;
        }
        if (body.error) patch.error = String(body.error).slice(0, 1000);
        await supabase.from('builds').update(patch).eq('id', build.id);
        await supabase.from('agents').update({ status: 'idle', current_build_id: null, last_seen: now }).eq('id', agent.id);
        await notifyBuild(build.id).catch(() => {});
        return res.status(200).json({ ok: true });
      }

      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error('Agent API error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
