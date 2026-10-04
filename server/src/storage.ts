import { del as blobDelete, get as blobGet, list as blobList, put as blobPut } from '@vercel/blob';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { isProduction } from './config.js';

export type FileAccess = 'public' | 'private';
export type PutOptions = {
  access: FileAccess;
  addRandomSuffix?: boolean;
  allowOverwrite?: boolean;
  contentType?: string;
  cacheControlMaxAge?: number;
};

type StoredBlob = {
  pathname: string;
  url: string;
  size: number;
  uploadedAt: Date;
  downloadUrl: string;
  etag: string;
};

const localRoot = path.resolve(process.env.ADMIN_DATA_DIR || path.join(process.cwd(), 'data', 'storage'));
const hasBlobCredentials = Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
const useBlob = isProduction || hasBlobCredentials;

function localFile(pathname: string) {
  const safePath = pathname.replaceAll('\\', '/').replace(/^\/+/, '');
  const resolved = path.resolve(localRoot, safePath);
  if (resolved !== localRoot && !resolved.startsWith(`${localRoot}${path.sep}`)) {
    throw new Error('Invalid file path.');
  }
  return resolved;
}

function localUrl(pathname: string, access: FileAccess) {
  if (access === 'private') return '';
  return `/api/files/${pathname.split('/').map(encodeURIComponent).join('/')}`;
}

function localBlob(pathname: string, size: number, uploadedAt: Date, access: FileAccess): StoredBlob {
  return {
    pathname,
    url: localUrl(pathname, access),
    size,
    uploadedAt,
    downloadUrl: localUrl(pathname, access),
    etag: '',
  };
}

export async function put(pathname: string, body: Buffer | string, options: PutOptions): Promise<Pick<StoredBlob, 'url' | 'pathname'>> {
  if (useBlob) {
    return blobPut(pathname, body, options);
  }

  const destination = localFile(pathname);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, body, { flag: options.allowOverwrite ? 'w' : 'wx' });
  const stats = await fs.stat(destination);
  return localBlob(pathname, stats.size, stats.mtime, options.access);
}

export async function get(pathname: string, options: { access: FileAccess }) {
  if (useBlob) return blobGet(pathname, options);

  try {
    const filename = localFile(pathname);
    const stats = await fs.stat(filename);
    const content = await fs.readFile(filename);
    return {
      statusCode: 200 as const,
      stream: Readable.toWeb(Readable.from(content)) as ReadableStream<Uint8Array>,
      headers: new Headers(),
      blob: {
        ...localBlob(pathname, stats.size, stats.mtime, options.access),
        contentType: contentType(pathname),
      },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function list(options: { prefix: string; limit: number; cursor?: string }) {
  if (useBlob) return blobList(options);

  const prefix = options.prefix.replaceAll('\\', '/').replace(/^\/+/, '');
  const directory = localFile(prefix);
  let files: string[] = [];
  try {
    files = await collectFiles(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const all = await Promise.all(files.map(async filename => {
    const stats = await fs.stat(filename);
    const pathname = path.relative(localRoot, filename).split(path.sep).join('/');
    return localBlob(pathname, stats.size, stats.mtime, 'public');
  }));
  const start = options.cursor ? Number(options.cursor) : 0;
  const blobs = all.slice(start, start + options.limit);
  const next = start + options.limit;
  return {
    blobs,
    hasMore: next < all.length,
    cursor: next < all.length ? String(next) : undefined,
  };
}

export async function del(pathnames: string | string[]) {
  if (useBlob) return blobDelete(pathnames);
  await Promise.all((Array.isArray(pathnames) ? pathnames : [pathnames]).map(async pathname => {
    try {
      await fs.unlink(localFile(pathname));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }));
}

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(filename) : Promise.resolve([filename]);
  }));
  return files.flat().sort();
}

function contentType(pathname: string) {
  if (pathname.endsWith('.webp')) return 'image/webp';
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  if (pathname.endsWith('.pdf')) return 'application/pdf';
  if (pathname.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}
