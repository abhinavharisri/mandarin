/// <reference types="@cloudflare/workers-types" />
import { HttpError } from './env.js';

export async function listKeys(bucket: R2Bucket, prefix: string) {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    keys.push(...page.objects.map(object => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

export async function readJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const object = await bucket.get(key);
  return object ? object.json<T>() : null;
}

export async function requireJson<T>(bucket: R2Bucket, key: string, notFound: string): Promise<T> {
  const record = await readJson<T>(bucket, key);
  if (!record) throw new HttpError(404, notFound);
  return record;
}

export const putJson = (bucket: R2Bucket, key: string, value: unknown) =>
  bucket.put(key, JSON.stringify(value), { httpMetadata: { contentType: 'application/json' } });
