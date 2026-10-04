import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { config } from './config.js';

const cookieName = 'mo_admin_session';
const sessionDuration = 8 * 60 * 60;

function signature(payload: string) {
  return createHmac('sha256', config.ADMIN_SESSION_SECRET).update(payload).digest('base64url');
}

function cookieValue(request: Request) {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return '';
  const cookie = cookieHeader.split(';').map(value => value.trim())
    .find(value => value.startsWith(`${cookieName}=`));
  return cookie?.slice(cookieName.length + 1) || '';
}

/** Constant-time comparison against the configured admin password. */
export function passwordMatches(password: string) {
  const submitted = Buffer.from(password);
  const expected = Buffer.from(config.ADMIN_PASSWORD);
  return submitted.length === expected.length && timingSafeEqual(submitted, expected);
}

/** Returns the session's expiry (Unix seconds) when the cookie is valid, otherwise null. */
export function sessionExpiry(request: Request) {
  const [payload, suppliedSignature, extra] = cookieValue(request).split('.');
  if (!payload || !suppliedSignature || extra) return null;

  const expected = Buffer.from(signature(payload));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { expiresAt?: number };
    return typeof session.expiresAt === 'number' && session.expiresAt > Math.floor(Date.now() / 1000)
      ? session.expiresAt
      : null;
  } catch {
    return null;
  }
}

export function isAdmin(request: Request) {
  return sessionExpiry(request) !== null;
}

// Best-effort brute-force protection. State is per server instance, so it slows
// guessing rather than guaranteeing a global limit.
const loginWindow = 15 * 60 * 1000;
const maxFailedLogins = 5;
const failedLogins = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: Request) {
  return String(request.get('x-forwarded-for') || request.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

/** Seconds until the client may try again, or 0 when sign-in is allowed. */
export function loginRetryAfter(request: Request) {
  const entry = failedLogins.get(clientKey(request));
  if (!entry || entry.resetAt <= Date.now()) return 0;
  return entry.count >= maxFailedLogins ? Math.ceil((entry.resetAt - Date.now()) / 1000) : 0;
}

export function recordLoginAttempt(request: Request, succeeded: boolean) {
  const key = clientKey(request);
  if (succeeded) {
    failedLogins.delete(key);
    return;
  }
  const now = Date.now();
  for (const [storedKey, entry] of failedLogins) if (entry.resetAt <= now) failedLogins.delete(storedKey);
  const entry = failedLogins.get(key);
  if (entry && entry.resetAt > now) entry.count += 1;
  else failedLogins.set(key, { count: 1, resetAt: now + loginWindow });
}

/** Rejects cross-site state-changing requests (defence in depth alongside SameSite=Strict). */
export function requireSameOrigin(request: Request, response: Response, next: NextFunction) {
  const origin = request.get('origin');
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method) || !origin) {
    next();
    return;
  }
  const forwardedHost = request.get('x-forwarded-host') || request.get('host');
  let originHost = '';
  try { originHost = new URL(origin).host; } catch { /* rejected below */ }
  if (!originHost || originHost !== forwardedHost) {
    response.status(403).json({ error: 'This request was blocked because it came from another site.' });
    return;
  }
  next();
}

export function setAdminSession(request: Request, response: Response) {
  const expiresAt = Math.floor(Date.now() / 1000) + sessionDuration;
  const payload = Buffer.from(JSON.stringify({ expiresAt })).toString('base64url');
  const secure = request.secure || request.get('x-forwarded-proto') === 'https';
  response.setHeader('Set-Cookie', [
    `${cookieName}=${payload}.${signature(payload)}`,
    'Path=/api/admin',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${sessionDuration}`,
    ...(secure ? ['Secure'] : []),
  ].join('; '));
  return expiresAt;
}

export function clearAdminSession(request: Request, response: Response) {
  const secure = request.secure || request.get('x-forwarded-proto') === 'https';
  response.setHeader('Set-Cookie', [
    `${cookieName}=`,
    'Path=/api/admin',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
    ...(secure ? ['Secure'] : []),
  ].join('; '));
}

export function requireAdmin(request: Request, response: Response, next: NextFunction) {
  if (!isAdmin(request)) {
    response.status(401).json({ error: 'Sign in to continue.' });
    return;
  }
  next();
}
