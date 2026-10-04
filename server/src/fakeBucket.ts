/// <reference types="@cloudflare/workers-types" />
// Minimal in-memory R2 bucket for tests, including ETag preconditions.

type Stored = { body: string; etag: string; uploaded: Date; contentType?: string };

export function fakeBucket() {
  const objects = new Map<string, Stored>();
  let version = 0;
  const toObject = (key: string, stored: Stored) => ({
    key,
    etag: stored.etag,
    httpEtag: `"${stored.etag}"`,
    uploaded: stored.uploaded,
    httpMetadata: { contentType: stored.contentType },
    body: new Response(stored.body).body,
    json: async () => JSON.parse(stored.body),
    text: async () => stored.body,
    arrayBuffer: async () => new TextEncoder().encode(stored.body).buffer,
  });
  const bucket = {
    async get(key: string) {
      const stored = objects.get(key);
      return stored ? toObject(key, stored) : null;
    },
    async put(key: string, value: string | Uint8Array, options: { onlyIf?: { etagMatches?: string }; httpMetadata?: { contentType?: string } } = {}) {
      const current = objects.get(key);
      if (options.onlyIf?.etagMatches && current?.etag !== options.onlyIf.etagMatches) return null;
      const stored = { body: typeof value === 'string' ? value : new TextDecoder().decode(value), etag: `v${++version}`, uploaded: new Date(Date.now() + version), contentType: options.httpMetadata?.contentType };
      objects.set(key, stored);
      return toObject(key, stored);
    },
    async delete(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
    async list(options: { prefix?: string } = {}) {
      const matching = [...objects.entries()].filter(([key]) => key.startsWith(options.prefix || ''));
      return { objects: matching.map(([key, stored]) => toObject(key, stored)), truncated: false, cursor: undefined };
    },
  };
  return { bucket: bucket as unknown as R2Bucket, objects };
}
