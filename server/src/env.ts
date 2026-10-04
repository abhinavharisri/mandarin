/// <reference types="@cloudflare/workers-types" />

/** Bindings configured in wrangler.toml and the Cloudflare Pages dashboard. */
export type Env = {
  /** R2 bucket holding gallery photos, invoice PDFs and their records. */
  BUCKET?: R2Bucket;
  /** Static site assets (provided by Cloudflare Pages). Used to embed the logo in invoices. */
  ASSETS?: Fetcher;
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
};

export type AdminConfig = { password: string; sessionSecret: string; bucket: R2Bucket };

const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly headers: HeadersInit = {}) {
    super(message);
  }
}

/**
 * Resolves admin settings. Local development falls back to a known password so the
 * dashboard works without setup; any other host must have real secrets configured.
 */
export function adminConfig(env: Env, request: Request): AdminConfig {
  const local = localHosts.has(new URL(request.url).hostname);
  const password = env.ADMIN_PASSWORD || (local ? 'mandarin-local-password' : '');
  const sessionSecret = env.ADMIN_SESSION_SECRET || (local ? 'local-only-session-secret-change-before-deploy-00000000' : '');
  if (password.length < 12 || sessionSecret.length < 32) {
    throw new HttpError(503, 'The admin panel is not configured yet. Set ADMIN_PASSWORD (12+ characters) and ADMIN_SESSION_SECRET (32+ characters) in Cloudflare Pages.');
  }
  if (!env.BUCKET) throw new HttpError(503, 'Storage is not connected. Add an R2 bucket binding named BUCKET in Cloudflare Pages.');
  return { password, sessionSecret, bucket: env.BUCKET };
}
