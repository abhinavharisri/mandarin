import { AdminConfig, HttpError } from './env.js';

const cookieName = 'mo_admin_session';
const sessionDuration = 8 * 60 * 60;
const encoder = new TextEncoder();

/** Constant-time comparison for equal-length secrets. */
function safeEqual(a: string, b: string) {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const fromBase64Url = (value: string) =>
  atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4));

async function signature(payload: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))));
}

export const passwordMatches = (password: string, config: AdminConfig) => safeEqual(password, config.password);

function cookieValue(request: Request) {
  const cookie = (request.headers.get('cookie') || '').split(';').map(value => value.trim())
    .find(value => value.startsWith(`${cookieName}=`));
  return cookie?.slice(cookieName.length + 1) || '';
}

/** Returns the session's expiry (Unix seconds) when the cookie is valid, otherwise null. */
export async function sessionExpiry(request: Request, config: AdminConfig) {
  const [payload, suppliedSignature, extra] = cookieValue(request).split('.');
  if (!payload || !suppliedSignature || extra) return null;
  if (!safeEqual(await signature(payload, config.sessionSecret), suppliedSignature)) return null;
  try {
    const session = JSON.parse(fromBase64Url(payload)) as { expiresAt?: number };
    return typeof session.expiresAt === 'number' && session.expiresAt > Math.floor(Date.now() / 1000) ? session.expiresAt : null;
  } catch {
    return null;
  }
}

const secureFlag = (request: Request) => new URL(request.url).protocol === 'https:' ? ['Secure'] : [];

export async function sessionCookie(request: Request, config: AdminConfig) {
  const expiresAt = Math.floor(Date.now() / 1000) + sessionDuration;
  const payload = toBase64Url(encoder.encode(JSON.stringify({ expiresAt })));
  const cookie = [
    `${cookieName}=${payload}.${await signature(payload, config.sessionSecret)}`,
    'Path=/api/admin', 'HttpOnly', 'SameSite=Strict', `Max-Age=${sessionDuration}`, ...secureFlag(request),
  ].join('; ');
  return { cookie, expiresAt };
}

export const clearedSessionCookie = (request: Request) =>
  [`${cookieName}=`, 'Path=/api/admin', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0', ...secureFlag(request)].join('; ');

export async function requireAdmin(request: Request, config: AdminConfig) {
  if (await sessionExpiry(request, config) === null) throw new HttpError(401, 'Sign in to continue.');
}

// Best-effort brute-force protection. State lives in one Worker isolate, so it slows
// guessing rather than guaranteeing a global limit.
const loginWindow = 15 * 60 * 1000;
const maxFailedAttempts = 5;
const failedAttempts = new Map<string, { count: number; resetAt: number }>();
const clientKey = (request: Request) => request.headers.get('cf-connecting-ip') || 'local';

export function assertNotThrottled(request: Request) {
  const entry = failedAttempts.get(clientKey(request));
  if (!entry || entry.resetAt <= Date.now() || entry.count < maxFailedAttempts) return;
  const retryAfter = Math.ceil((entry.resetAt - Date.now()) / 1000);
  throw new HttpError(429, `Too many attempts. Try again in ${Math.ceil(retryAfter / 60)} minutes.`, { 'Retry-After': String(retryAfter) });
}

export function recordAttempt(request: Request, succeeded: boolean) {
  const key = clientKey(request);
  if (succeeded) {
    failedAttempts.delete(key);
    return;
  }
  const now = Date.now();
  for (const [storedKey, entry] of failedAttempts) if (entry.resetAt <= now) failedAttempts.delete(storedKey);
  const entry = failedAttempts.get(key);
  if (entry && entry.resetAt > now) entry.count += 1;
  else failedAttempts.set(key, { count: 1, resetAt: now + loginWindow });
}

/** Rejects cross-site state-changing requests (defence in depth alongside SameSite=Strict). */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method) || !origin) return;
  let originHost = '';
  try { originHost = new URL(origin).host; } catch { /* rejected below */ }
  const allowed = new Set([new URL(request.url).host, request.headers.get('host')]);
  if (!originHost || !allowed.has(originHost)) {
    throw new HttpError(403, 'This request was blocked because it came from another site.');
  }
}
