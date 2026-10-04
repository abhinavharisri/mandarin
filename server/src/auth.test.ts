import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSameOrigin, passwordMatches, readSession, sessionCookie, sessionExpiry, sessionIdleSeconds, sessionMaxSeconds } from './auth.js';
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

test('expires after 30 idle minutes, renews with activity, and never outlives 12 hours', async () => {
  const start = 1_800_000_000;
  const withCookie = (cookie: string) => new Request(local, { headers: { cookie: cookie.split(';')[0] } });

  const first = await sessionCookie(local, config, undefined, start);
  assert.equal(first.expiresAt, start + sessionIdleSeconds);
  assert.match(first.cookie, new RegExp(`Max-Age=${sessionIdleSeconds}`));
  assert.ok(await readSession(withCookie(first.cookie), config, start + 29 * 60));
  assert.equal(await readSession(withCookie(first.cookie), config, start + 31 * 60), null);

  // Activity at minute 20 pushes expiry to minute 50, keeping the original sign-in time.
  const session = (await readSession(withCookie(first.cookie), config, start + 20 * 60))!;
  const renewed = await sessionCookie(local, config, session.issuedAt, start + 20 * 60);
  assert.equal(renewed.expiresAt, start + 50 * 60);
  assert.ok(await readSession(withCookie(renewed.cookie), config, start + 45 * 60));

  // Renewing near the 12-hour mark is capped at 12 hours after sign-in.
  const late = await sessionCookie(local, config, start, start + sessionMaxSeconds - 60);
  assert.equal(late.expiresAt, start + sessionMaxSeconds);
  assert.equal(await readSession(withCookie(late.cookie), config, start + sessionMaxSeconds), null);
});

test('rejects older cookies that have no sign-in time', async () => {
  const legacy = Buffer.from(JSON.stringify({ expiresAt: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const crypto = await import('node:crypto');
  const signature = crypto.createHmac('sha256', config.sessionSecret).update(legacy).digest('base64url');
  assert.equal(await readSession(new Request(local, { headers: { cookie: `mo_admin_session=${legacy}.${signature}` } }), config), null);
});
