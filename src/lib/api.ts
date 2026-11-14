import supabase from './supabase';

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token || ''}`,
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

export async function uploadZip(file: File, onProgress: (p: number) => void): Promise<string> {
  const { signedUrl, path } = await api<{ signedUrl: string; path: string }>('/api/upload', {
    method: 'POST',
    body: { fileName: file.name },
  });
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', signedUrl);
    xhr.setRequestHeader('Content-Type', 'application/zip');
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText.slice(0, 160)}`)));
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(file);
  });
  onProgress(1);
  return path;
}
