import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSameOrigin, passwordMatches, sessionCookie, sessionExpiry } from './auth.js';
import { adminConfig, HttpError } from './env.js';

const bucket = {} as R2Bucket;
const local = new Request('http://localhost:8788/api/admin/session');
const config = adminConfig({ BUCKET: bucket }, local);

test('signs a session cookie that verifies and rejects tampering', async () => {
  const { cookie, expiresAt } = await sessionCookie(local, config);
  const value = cookie.split(';')[0];
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  assert.equal(await sessionExpiry(new Request(local, { headers: { cookie: value } }), config), expiresAt);
  const tampered = value.replace(/.$/, character => (character === 'A' ? 'B' : 'A'));
  assert.equal(await sessionExpiry(new Request(local, { headers: { cookie: tampered } }), config), null);
  assert.equal(await sessionExpiry(new Request(local, { headers: { cookie: value } }), { ...config, sessionSecret: 'x'.repeat(40) }), null);
});

test('marks cookies Secure over HTTPS', async () => {
  const { cookie } = await sessionCookie(new Request('https://mandarinorchid.in/api/admin/login'), config);
  assert.match(cookie, /; Secure$/);
});

test('uses the local password only on localhost', () => {
  assert.ok(passwordMatches('mandarin-local-password', config));
  assert.ok(!passwordMatches('wrong-password', config));
  assert.throws(() => adminConfig({ BUCKET: bucket }, new Request('https://mandarinorchid.in/api/admin/session')), HttpError);
});

test('blocks cross-site writes', () => {
  const post = (origin: string) => new Request('https://mandarinorchid.in/api/admin/logout', { method: 'POST', headers: { origin } });
  assert.doesNotThrow(() => assertSameOrigin(post('https://mandarinorchid.in')));
  assert.throws(() => assertSameOrigin(post('https://evil.example')), HttpError);
});
