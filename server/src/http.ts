/// <reference types="@cloudflare/workers-types" />
import { HttpError } from './env.js';

export const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

export const noContent = (headers: HeadersInit = {}) => new Response(null, { status: 204, headers });

export async function jsonBody(request: Request) {
  try { return await request.json(); } catch { return null; }
}

/**
 * Read-modify-write for a JSON object in R2 using its ETag, retrying when another
 * request changed it in between, so simultaneous edits are never lost.
 */
export async function updateJson<T>(bucket: R2Bucket, key: string, notFound: string, mutate: (current: T) => T | Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const object = await bucket.get(key);
    if (!object) throw new HttpError(404, notFound);
    const next = await mutate(await object.json<T>());
    const written = await bucket.put(key, JSON.stringify(next), {
      httpMetadata: { contentType: 'application/json' },
      onlyIf: { etagMatches: object.etag },
    });
    if (written) return next;
    await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
  }
  throw new HttpError(409, 'Someone else is updating this at the same moment. Please try again.');
}
