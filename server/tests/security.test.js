import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-master-key-for-unit-tests-only';
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co';

const { kotlinString, androidStringResource, packageNameError, derivePackageName, cleanAppName, xmlEscape } = await import('../lib/sanitize.js');
const { isBlockedIp, assertPublicUrl } = await import('../lib/ssrf.js');
const { encrypt, decrypt, hmacHash, safeEqual } = await import('../lib/crypto.js');

test('kotlinString escapes $, quotes, backslashes and control chars', () => {
  assert.equal(kotlinString('a$b"c\\d\n'), '"a\\$b\\"c\\\\d\\n"');
  assert.equal(kotlinString('${System.exit(0)}'), '"\\${System.exit(0)}"');
  assert.equal(kotlinString('\u2028'), '"\\u2028"');
});

test('android string resource escaping', () => {
  assert.equal(androidStringResource("Bob's <App> & \"Co\" \\"), "Bob\\'s &lt;App&gt; &amp; \\\"Co\\\" \\\\");
  assert.equal(androidStringResource('@string/x'), '\\@string/x');
  assert.equal(androidStringResource('?attr'), '\\?attr');
  assert.equal(xmlEscape('"><x'), '&quot;&gt;&lt;x');
});

test('package name validation', () => {
  assert.equal(packageNameError('com.example.app'), null);
  for (const bad of ['Com.example', 'com', 'com.my-app', 'com.1app', 'com.example.fun', 'com.example.int', 'com..x', 'com.example.app ', 'com.ex$ample']) {
    assert.ok(packageNameError(bad), `should reject ${bad}`);
  }
  assert.equal(derivePackageName('https://www.my-site.co.uk/x'), 'uk.co.my_site.web');
  assert.equal(derivePackageName('https://1and1.com'), 'com.n1and1.web');
  assert.equal(derivePackageName('https://fun.in'), 'inapp.funapp.web');
  assert.equal(packageNameError(derivePackageName('https://über-café.de')), null);
});

test('app name cleaning', () => {
  assert.equal(cleanAppName('  My\u202eApp\n\tName  '), 'My App Name');
  assert.equal(cleanAppName(''), 'Web App');
  assert.equal(cleanAppName('x'.repeat(100)).length, 50);
});

test('SSRF: blocked IPs', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.5.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::ffff:127.0.0.1', 'fd00:ec2::254', 'fe80::1', '224.0.0.1', '64:ff9b::7f00:1', '::ffff:7f00:1', '2002:7f00:1::1']) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.215.14', '2606:4700:4700::1111', '2a00:1450:4001::200e']) assert.equal(isBlockedIp(ip), false, ip);
});

test('SSRF: URL rules', async () => {
  for (const u of ['file:///etc/passwd', 'http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data', 'http://metadata.google.internal/', 'http://2130706433/', 'http://0x7f000001/', 'http://user:pw@example.com/', 'http://example.com:22/', 'gopher://example.com/', 'http://intranet/']) {
    await assert.rejects(assertPublicUrl(u), undefined, u);
  }
});

test('crypto: AES-GCM round trip, tamper detection, keyed hashes', () => {
  const c = encrypt('123456:ABCdef');
  assert.equal(decrypt(c), '123456:ABCdef');
  const parts = c.split(':');
  parts[4] = Buffer.from('x').toString('base64url');
  assert.throws(() => decrypt(parts.join(':')));
  assert.notEqual(hmacHash('k', 'api-key'), hmacHash('k', 'agent-token'));
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
});
