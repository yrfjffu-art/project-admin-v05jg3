// Everything that gets written into generated Kotlin / XML / Gradle files goes through here.

const KOTLIN_KEYWORDS = 'as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while'.split(' ');
const JAVA_KEYWORDS = 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record yield sealed permits'.split(' ');
const RESERVED = new Set([...KOTLIN_KEYWORDS, ...JAVA_KEYWORDS, '_']);

export function packageNameError(p) {
  if (typeof p !== 'string' || !p) return 'package_name is required';
  if (p.length > 150) return 'package_name is too long (max 150)';
  const segs = p.split('.');
  if (segs.length < 2) return 'package_name needs at least two segments, e.g. com.example.app';
  for (const s of segs) {
    if (!/^[a-z][a-z0-9_]*$/.test(s)) return `package_name segment "${s}" must start with a lowercase letter and contain only a-z, 0-9 and _`;
    if (RESERVED.has(s)) return `package_name segment "${s}" is a reserved Java/Kotlin keyword`;
  }
  return null;
}

function cleanSegment(s) {
  let x = s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!x) return null;
  if (/^[0-9]/.test(x)) x = 'n' + x;
  if (RESERVED.has(x)) x = x + 'app';
  return x.slice(0, 40);
}

/** Build a valid application id from a website host, e.g. https://my-site.co.uk -> uk.co.my_site.web */
export function derivePackageName(url) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const segs = host.split('.').reverse().map(cleanSegment).filter(Boolean).slice(0, 4);
  while (segs.length < 2) segs.unshift('app');
  segs.push('web');
  const p = segs.join('.');
  return packageNameError(p) ? 'com.web2apk.app' : p;
}

/** App label: strip control/bidi characters, collapse whitespace, cap length. */
export function cleanAppName(s, fallback = 'Web App') {
  const x = String(s ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50)
    .trim();
  return x || fallback;
}

/** Kotlin string literal (with quotes). Escapes \ " $ and control characters. */
export function kotlinString(s) {
  let out = '';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '$') out += '\\$';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029) out += '\\u' + c.toString(16).padStart(4, '0');
    else out += ch;
  }
  return `"${out}"`;
}

/** XML text/attribute escaping. */
export function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Value for an Android <string> resource: Android escapes first, then XML escapes. */
export function androidStringResource(s) {
  let x = String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  if (/^[@?]/.test(x)) x = '\\' + x;
  return x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
