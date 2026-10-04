import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import {
  clearAdminSession, isAdmin, loginRetryAfter, passwordMatches, recordLoginAttempt, requireAdmin, requireSameOrigin, sessionExpiry, setAdminSession,
} from './auth.js';
import { buildInvoicePdf, calculateTotals, InvoiceLine } from './invoice.js';
import { del, get, list, put } from './storage.js';

type GalleryRecord = {
  id: string;
  alt_text: string;
  category: 'rooms' | 'common' | 'exteriors' | 'landscapes';
  image_url: string;
  image_path?: string;
  full_image_url?: string;
  srcset?: string;
  sizes?: string;
  created_at: string;
};

type InvoiceRecord = {
  id: string;
  invoice_number: string;
  guest_name: string;
  guest_email: string | null;
  total_amount: number;
  currency: 'INR';
  created_at: string;
  pdf_path: string;
  source_bill_path: string | null;
};

export const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 12 },
});
const lineSchema = z.array(z.object({
  description: z.string().trim().min(1).max(180),
  quantity: z.number().int().min(1).max(9999),
  unitPrice: z.number().min(0).max(10_000_000),
})).min(1).max(30);

const gallerySeeds = [
  ['livingroom', 'Living room interior with ornate wooden sofa and warm lighting', 'common', 1600, [480, 960, 1600, 2048, 2400, 3200], 3200],
  ['doubleroom', 'Double room with white linen bed and wooden paneled wall', 'rooms', 1080, [480, 960, 1080], 1080],
  ['chandelierheroimage2', 'Wooden ceiling and chandelier detail shot', 'common', 1600, [480, 960, 1600, 2048], 2048],
  ['hall', 'Antique gramophone and brass decor', 'common', 1600, [480, 960, 1600, 2048, 2400, 2430], 2430],
  ['resortexterior1heroimage1', 'Cottage exterior with roof and window details', 'exteriors', 1600, [480, 960, 1600, 2048], 2048],
  ['mistandmornings', 'Nilgiri valley panorama with green hills and misty sky', 'landscapes', 1600, [480, 960, 1600, 2048, 2400, 3200], 3200],
  ['privatevillaheroimage3', 'Villa exterior on hillside with Nilgiri backdrop', 'exteriors', 1600, [480, 960, 1600, 2048], 2048],
  ['diningroom1', 'Formal dining room with carved wooden chairs', 'common', 1600, [480, 960, 1600, 2048, 2400, 3200], 3200],
  ['privategarden', 'Private garden lawn with morning light', 'exteriors', 736, [480, 736], 736],
  ['heritagevillasittingroom', 'Villa room sitting area with sofa and side table', 'rooms', 1600, [480, 960, 1600, 2048, 2400, 3200], 3200],
  ['bathroom2', 'Bathroom interior and hot water setup', 'rooms', 0, [], 0],
  ['kodanadu', 'Kodanadu viewpoint panorama', 'landscapes', 1333, [480, 960, 1333], 1333],
  ['sofa', 'Elegant sofa seating in resort interior', 'common', 1600, [480, 960, 1600], 1600],
  ['hallsofa', 'Hall seating area with sofa and warm lighting', 'common', 1600, [480, 960, 1600], 1600],
  ['tvwood', 'Wooden interior with television and warm decor', 'common', 1200, [480, 960, 1200], 1200],
] as const;

const builtInGallery: GalleryRecord[] = gallerySeeds.map(([name, alt_text, category, sourceWidth, widths, fullWidth], index) => {
  const path = name === 'bathroom2'
    ? '/images/bathroom2.avif'
    : `/images/optimized/${name}-${sourceWidth}.webp`;
  const fullImagePath = fullWidth ? `/images/optimized/${name}-${fullWidth}.webp` : path;
  return {
    id: `built-in-${name}`,
    alt_text,
    category,
    image_url: path,
    image_path: undefined,
    full_image_url: fullImagePath,
    srcset: widths.length
      ? widths.map(width => `/images/optimized/${name}-${width}.webp ${width}w`).join(', ')
      : undefined,
    sizes: '(max-width: 600px) 100vw, (max-width: 1000px) 50vw, 33vw',
    created_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
  };
});

async function listBlobs(prefix: string) {
  const blobs = [];
  let cursor: string | undefined;
  do {
    const result = await list({ prefix, limit: 1000, cursor });
    blobs.push(...result.blobs);
    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);
  return blobs;
}

async function readBlobJson<T>(pathname: string, access: 'public' | 'private'): Promise<T> {
  const blob = await get(pathname, { access });
  if (!blob || blob.statusCode !== 200) throw new StoredRecordNotFoundError(pathname);
  return new Response(blob.stream).json() as Promise<T>;
}

class StoredRecordNotFoundError extends Error {}

async function galleryRecords(): Promise<GalleryRecord[]> {
  const [records, hidden] = await Promise.all([
    listBlobs('gallery/'),
    listBlobs('gallery-hidden/'),
  ]);
  const jsonRecords = records.filter(blob => blob.pathname.endsWith('.json'));
  const images = await Promise.all(jsonRecords.map(blob => readBlobJson<GalleryRecord>(blob.pathname, 'public')));
  const hiddenIds = new Set(hidden.map(blob => blob.pathname.split('/').pop()?.replace(/\.json$/, '')));
  return [...builtInGallery.filter(image => !hiddenIds.has(image.id)), ...images]
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

async function invoiceRecords(): Promise<InvoiceRecord[]> {
  const records = await listBlobs('invoices/');
  const jsonRecords = records.filter(blob => blob.pathname.endsWith('.json'));
  const invoices = await Promise.all(jsonRecords.map(blob => readBlobJson<InvoiceRecord>(blob.pathname, 'private')));
  return invoices.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 100);
}

router.get('/health', (_request, response) => response.json({ status: 'ok' }));

router.use('/admin', requireSameOrigin);

router.post('/admin/login', (request, response) => {
  const retryAfter = loginRetryAfter(request);
  if (retryAfter) {
    response.setHeader('Retry-After', String(retryAfter));
    response.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil(retryAfter / 60)} minutes.` });
    return;
  }
  const input = z.object({ password: z.string().min(1).max(256) }).safeParse(request.body);
  if (!input.success) {
    response.status(400).json({ error: 'Enter the admin password.' });
    return;
  }
  if (!passwordMatches(input.data.password)) {
    recordLoginAttempt(request, false);
    response.status(401).json({ error: 'The password is incorrect.' });
    return;
  }
  recordLoginAttempt(request, true);
  const expiresAt = setAdminSession(request, response);
  response.json({ authenticated: true, expiresAt });
});

router.get('/admin/session', (request, response) => {
  const expiresAt = sessionExpiry(request);
  response.json({ authenticated: expiresAt !== null, expiresAt });
});
router.post('/admin/logout', (_request, response) => {
  clearAdminSession(_request, response);
  response.status(204).end();
});

router.get('/gallery', async (_request, response) => {
  response.json(await galleryRecords());
});

router.get('/files/:kind/:fileName', async (request, response) => {
  const { kind, fileName } = request.params;
  if (!['gallery', 'invoices'].includes(kind) || fileName.includes('/') || fileName.includes('\\')) {
    response.status(404).end();
    return;
  }
  if (kind === 'invoices' && !isAdmin(request)) {
    response.status(401).json({ error: 'Sign in to download billing documents.' });
    return;
  }

  const file = await get(`${kind}/${fileName}`, { access: kind === 'gallery' ? 'public' : 'private' });
  if (!file || file.statusCode !== 200) {
    response.status(404).json({ error: 'File was not found.' });
    return;
  }
  response.setHeader('Content-Type', file.blob.contentType);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (kind === 'invoices') response.setHeader('Cache-Control', 'private, no-store');
  Readable.fromWeb(file.stream as import('node:stream/web').ReadableStream).pipe(response);
});

router.use('/admin', requireAdmin);

router.get('/admin/gallery', async (_request, response) => {
  response.json(await galleryRecords());
});

router.post('/admin/gallery', upload.single('image'), async (request, response) => {
  const body = z.object({
    altText: z.string().trim().min(3).max(180),
    category: z.enum(['rooms', 'common', 'exteriors', 'landscapes']),
  }).safeParse(request.body);
  if (!body.success || !request.file) {
    response.status(400).json({ error: 'Choose an image and provide its description and collection.' });
    return;
  }

  const fileType = await fileTypeFromBuffer(request.file.buffer);
  if (!fileType || !['image/jpeg', 'image/png', 'image/webp'].includes(fileType.mime)) {
    response.status(415).json({ error: 'Only JPG, PNG, or WebP images are accepted.' });
    return;
  }

  const id = randomUUID();
  const imagePath = `gallery/${id}.webp`;
  const metadataPath = `gallery/${id}.json`;
  const optimized = await sharp(request.file.buffer, { limitInputPixels: 80_000_000 })
    .rotate().resize({ width: 2400, withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
  const image = await put(imagePath, optimized, {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'image/webp',
    cacheControlMaxAge: 60 * 60 * 24 * 365,
  });

  const record: GalleryRecord = {
    id,
    alt_text: body.data.altText,
    category: body.data.category,
    image_url: image.url,
    image_path: image.pathname,
    created_at: new Date().toISOString(),
  };
  try {
    await put(metadataPath, JSON.stringify(record), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json',
      cacheControlMaxAge: 60,
    });
  } catch (error) {
    await del(image.url);
    throw error;
  }
  response.status(201).json(record);
});

router.delete('/admin/gallery/:id', async (request, response) => {
  const id = z.string().regex(/^[a-z0-9-]{1,80}$/).safeParse(request.params.id);
  if (!id.success) {
    response.status(400).json({ error: 'Invalid gallery image.' });
    return;
  }

  const builtIn = builtInGallery.find(image => image.id === id.data);
  if (builtIn) {
    await put(`gallery-hidden/${builtIn.id}.json`, JSON.stringify({ id: builtIn.id }), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });
    response.status(204).end();
    return;
  }

  const metadataPath = `gallery/${id.data}.json`;
  let image: GalleryRecord;
  try {
    image = await readBlobJson<GalleryRecord>(metadataPath, 'public');
  } catch (error) {
    if (!(error instanceof StoredRecordNotFoundError)) throw error;
    response.status(404).json({ error: 'Gallery image was not found.' });
    return;
  }
  if (!image.image_path) {
    response.status(500).json({ error: 'The stored gallery record is missing its image path.' });
    return;
  }
  await del([metadataPath, image.image_path]);
  response.status(204).end();
});

router.get('/admin/invoices', async (_request, response) => {
  const invoices = await invoiceRecords();
  response.json(invoices.map(({ pdf_path: _pdf, source_bill_path: _source, ...invoice }) => invoice));
});

router.get('/admin/invoices/:id/download', async (request, response) => {
  const id = z.string().uuid().safeParse(request.params.id);
  if (!id.success) {
    response.status(400).json({ error: 'Invalid invoice.' });
    return;
  }

  let invoice: InvoiceRecord;
  try {
    invoice = await readBlobJson<InvoiceRecord>(`invoices/${id.data}.json`, 'private');
  } catch (error) {
    if (!(error instanceof StoredRecordNotFoundError)) throw error;
    response.status(404).json({ error: 'Invoice was not found.' });
    return;
  }
  const pdf = await get(invoice.pdf_path, { access: 'private' });
  if (!pdf || pdf.statusCode !== 200) {
    response.status(404).json({ error: 'The invoice PDF could not be found.' });
    return;
  }

  response.setHeader('Content-Type', 'application/pdf');
  response.setHeader('Content-Disposition', `attachment; filename="${invoice.invoice_number}.pdf"`);
  response.setHeader('Cache-Control', 'private, no-store');
  Readable.fromWeb(pdf.stream as import('node:stream/web').ReadableStream).pipe(response);
});

// Deleting a billing record requires the admin password again, not just a valid session.
router.delete('/admin/invoices/:id', async (request, response) => {
  const id = z.string().uuid().safeParse(request.params.id);
  const input = z.object({ password: z.string().min(1).max(256) }).safeParse(request.body);
  if (!id.success || !input.success) {
    response.status(400).json({ error: 'Enter the admin password to confirm.' });
    return;
  }
  const retryAfter = loginRetryAfter(request);
  if (retryAfter) {
    response.setHeader('Retry-After', String(retryAfter));
    response.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil(retryAfter / 60)} minutes.` });
    return;
  }
  // 403 rather than 401: a wrong confirmation password must not end the session.
  if (!passwordMatches(input.data.password)) {
    recordLoginAttempt(request, false);
    response.status(403).json({ error: 'The password is incorrect. The invoice was not removed.' });
    return;
  }

  const metadataPath = `invoices/${id.data}.json`;
  let invoice: InvoiceRecord;
  try {
    invoice = await readBlobJson<InvoiceRecord>(metadataPath, 'private');
  } catch (error) {
    if (!(error instanceof StoredRecordNotFoundError)) throw error;
    response.status(404).json({ error: 'Invoice was not found.' });
    return;
  }
  await del([metadataPath, invoice.pdf_path, ...(invoice.source_bill_path ? [invoice.source_bill_path] : [])]);
  response.status(204).end();
});

router.post('/admin/invoices', upload.single('sourceBill'), async (request, response) => {
  const invoiceInput = z.object({
    guestName: z.string().trim().min(1).max(140),
    guestEmail: z.union([z.string().email().max(254), z.literal('')]).optional(),
    stayStart: z.string().date(),
    stayEnd: z.string().date(),
    taxRate: z.coerce.number().min(0).max(100).default(0),
    lineItems: z.string().transform((value, context) => {
      try { return JSON.parse(value) as unknown; }
      catch {
        context.addIssue({ code: 'custom', message: 'Bill items must be valid JSON.' });
        return [];
      }
    }).pipe(lineSchema),
  }).safeParse(request.body);

  if (!invoiceInput.success) {
    response.status(400).json({ error: 'Check the guest, stay dates, tax rate, and bill items.' });
    return;
  }
  if (invoiceInput.data.stayEnd < invoiceInput.data.stayStart) {
    response.status(400).json({ error: 'Check-out must be on or after check-in.' });
    return;
  }
  if (request.file) {
    const fileType = await fileTypeFromBuffer(request.file.buffer);
    if (fileType?.mime !== 'application/pdf') {
      response.status(415).json({ error: 'The attached source bill must be a valid PDF.' });
      return;
    }
  }

  const lineItems = invoiceInput.data.lineItems as InvoiceLine[];
  const totals = calculateTotals(lineItems, invoiceInput.data.taxRate);
  if (!Number.isFinite(totals.total) || totals.total > 9_999_999_999.99) {
    response.status(400).json({ error: 'The invoice total exceeds the supported maximum.' });
    return;
  }

  const id = randomUUID();
  const invoiceNumber = `MO-${new Date().getFullYear()}-${id.slice(0, 12).toUpperCase()}`;
  const createdAt = new Date();
  const pdfPath = `invoices/${id}.pdf`;
  const sourceBillPath = request.file ? `invoices/${id}-source.pdf` : null;
  const pdf = await buildInvoicePdf({
    invoiceNumber,
    issueDate: createdAt,
    guestName: invoiceInput.data.guestName,
    guestEmail: invoiceInput.data.guestEmail || undefined,
    stayStart: new Date(`${invoiceInput.data.stayStart}T00:00:00`),
    stayEnd: new Date(`${invoiceInput.data.stayEnd}T00:00:00`),
    taxRate: invoiceInput.data.taxRate,
    lineItems,
  });

  const saved: string[] = [];
  try {
    await put(pdfPath, pdf, { access: 'private', addRandomSuffix: false, contentType: 'application/pdf' });
    saved.push(pdfPath);
    if (request.file && sourceBillPath) {
      await put(sourceBillPath, request.file.buffer, {
        access: 'private',
        addRandomSuffix: false,
        contentType: 'application/pdf',
      });
      saved.push(sourceBillPath);
    }

    const record: InvoiceRecord = {
      id,
      invoice_number: invoiceNumber,
      guest_name: invoiceInput.data.guestName,
      guest_email: invoiceInput.data.guestEmail || null,
      total_amount: totals.total,
      currency: 'INR',
      created_at: createdAt.toISOString(),
      pdf_path: pdfPath,
      source_bill_path: sourceBillPath,
    };
    const metadataPath = `invoices/${id}.json`;
    await put(metadataPath, JSON.stringify(record), {
      access: 'private',
      addRandomSuffix: false,
      contentType: 'application/json',
    });
    saved.push(metadataPath);
  } catch (error) {
    if (saved.length) await del(saved);
    throw error;
  }

  response.setHeader('Content-Type', 'application/pdf');
  response.setHeader('Content-Disposition', `attachment; filename="${invoiceNumber}.pdf"`);
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Invoice-Number', invoiceNumber);
  response.status(201).send(pdf);
});
