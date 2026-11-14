import dns from 'node:dns';
import net from 'node:net';
import { Agent, fetch as ufetch } from 'undici';
import { HttpError } from './http.js';

// Ranges that must never be reached from the server (private, loopback, link-local,
// cloud metadata, CGNAT, multicast, documentation, NAT64, mapped addresses...).
const block = new net.BlockList();
for (const [a, p] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) block.addSubnet(a, p, 'ipv4');
for (const [a, p] of [
  ['::', 128], ['::1', 128], ['100::', 64],
  ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]) block.addSubnet(a, p, 'ipv6');

export function isBlockedIp(ip) {
  const fam = net.isIP(ip);
  if (!fam) return true;
  if (fam === 4) return block.check(ip, 'ipv4');
  const lower = ip.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped || lower.startsWith('::ffff:')) return true; // IPv4-mapped IPv6 is never needed for public sites
  if (/^64:ff9b:/.test(lower)) return true; // NAT64 (embeds an IPv4 address)
  return block.check(lower, 'ipv6');
}

const BLOCKED_HOSTS = /(^|\.)(localhost|local|internal|localdomain|home\.arpa|intranet|lan|corp)$/i;
const METADATA_HOSTS = new Set(['metadata', 'metadata.google.internal', 'instance-data', 'metadata.azure.com']);
const DEFAULT_PORTS = new Set(['', '80', '443', '8080', '8443']);

function lookupAll(host) {
  return new Promise((resolve, reject) => dns.lookup(host, { all: true, verbatim: true }, (e, a) => (e ? reject(e) : resolve(a))));
}

/** Validate a URL syntactically and check every DNS answer is a public address. */
export async function assertPublicUrl(input, { allowHttp = true, field = 'url' } = {}) {
  let u;
  try { u = new URL(String(input).trim()); } catch { throw new HttpError(400, `${field}: not a valid URL`); }
  if (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:')) {
    throw new HttpError(400, `${field}: only ${allowHttp ? 'http(s)' : 'https'} URLs are allowed`);
  }
  if (u.username || u.password) throw new HttpError(400, `${field}: credentials in URLs are not allowed`);
  if (!DEFAULT_PORTS.has(u.port)) throw new HttpError(400, `${field}: port ${u.port} is not allowed`);
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || BLOCKED_HOSTS.test(host) || METADATA_HOSTS.has(host) || !host.includes('.') && !net.isIP(host)) {
    throw new HttpError(400, `${field}: this host is not allowed`);
  }
  // Reject numeric host tricks (e.g. 2130706433, 0x7f.1) that some resolvers accept.
  if (!net.isIP(host) && /^[\d.x]+$/i.test(host)) throw new HttpError(400, `${field}: this host is not allowed`);
  let addrs;
  try { addrs = net.isIP(host) ? [{ address: host }] : await lookupAll(host); }
  catch { throw new HttpError(400, `${field}: host does not resolve`); }
  if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) {
    throw new HttpError(400, `${field}: resolves to a private or reserved address`);
  }
  return u;
}

// The connect-time lookup re-checks the IP actually used for the socket, which defeats
// DNS-rebinding between assertPublicUrl() and the request.
function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) {
      const e = new Error('Blocked address'); e.code = 'EBLOCKED';
      return cb(e);
    }
    if (options && options.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}

const agent = new Agent({ connect: { lookup: safeLookup, timeout: 5000 }, headersTimeout: 10000, bodyTimeout: 10000 });

/**
 * SSRF-safe fetch: http(s) only, public IPs only, manual redirects (each hop re-validated),
 * timeout and response size cap.
 */
export async function safeFetch(url, { method = 'GET', headers = {}, body, maxBytes = 1_000_000, timeoutMs = 8000, maxRedirects = 3, allowHttp = true, field = 'url' } = {}) {
  let current = (await assertPublicUrl(url, { allowHttp, field })).href;
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; ; hop++) {
    let res;
    try {
      res = await ufetch(current, { method, headers: { 'user-agent': 'Web2APK/1.0 (+safe-fetch)', ...headers }, body, redirect: 'manual', dispatcher: agent, signal });
    } catch (e) {
      const code = e?.cause?.code || e?.code;
      if (code === 'EBLOCKED') throw new HttpError(400, `${field}: resolves to a private or reserved address`);
      if (e?.name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT') throw new HttpError(400, `${field}: request timed out`);
      throw new HttpError(400, `${field}: could not connect`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel().catch(() => {});
      if (hop >= maxRedirects) throw new HttpError(400, `${field}: too many redirects`);
      const next = new URL(res.headers.get('location'), current);
      current = (await assertPublicUrl(next.href, { allowHttp, field })).href;
      if (res.status === 303) method = 'GET', body = undefined;
      continue;
    }
    const chunks = [];
    let size = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel().catch(() => {}); throw new HttpError(400, `${field}: response is larger than ${maxBytes >= 1024 ? Math.round(maxBytes / 1024) + " KB" : maxBytes + " bytes"}`); }
        chunks.push(value);
      }
    }
    return { status: res.status, headers: res.headers, url: current, body: Buffer.concat(chunks.map((c) => Buffer.from(c))) };
  }
}
