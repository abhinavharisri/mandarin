/// <reference types="@cloudflare/workers-types" />
import { z } from 'zod';
import {
  assertNotThrottled, assertSameOrigin, clearedSessionCookie, passwordMatches, readSession, recordAttempt, requireAdmin, sessionCookie,
} from './auth.js';
import { adminConfig, Env, HttpError } from './env.js';
import { json, jsonBody, noContent } from './http.js';
import { buildInvoicePdf, calculateTotals, InvoiceLine } from './invoice.js';
import { loadMenu, menuRoutes } from './menu.js';
import { buildReportPdf } from './reportPdf.js';
import { buildReport, InvoiceRecord } from './reports.js';
import { listKeys, putJson, readJson, requireJson } from './storage.js';
import { closeTab, tabRoutes } from './tabs.js';

type Category = 'rooms' | 'common' | 'exteriors' | 'landscapes';

type GalleryRecord = {
  id: string;
  alt_text: string;
  category: Category;
  image_url: string;
  image_key?: string;
  full_image_url?: string;
  srcset?: string;
  sizes?: string;
  created_at: string;
};


const maxImageBytes = 8 * 1024 * 1024;
const maxBillBytes = 10 * 1024 * 1024;
const categories = ['rooms', 'common', 'exteriors', 'landscapes'] as const;
const lineSchema = z.array(z.object({
  description: z.string().trim().min(1).max(180),
  quantity: z.number().min(0.5).max(9999).refine(value => Number.isInteger(value * 2), 'Use whole or half quantities.'),
  unitPrice: z.number().min(0).max(10_000_000),
  section: z.string().trim().max(60).optional(),
  itemId: z.string().regex(/^[a-z0-9-]{1,80}$/).optional(),
})).min(1).max(150);

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
  const path = name === 'bathroom2' ? '/images/bathroom2.avif' : `/images/optimized/${name}-${sourceWidth}.webp`;
  return {
    id: `built-in-${name}`,
    alt_text,
    category,
    image_url: path,
    full_image_url: fullWidth ? `/images/optimized/${name}-${fullWidth}.webp` : path,
    srcset: widths.length ? widths.map(width => `/images/optimized/${name}-${width}.webp ${width}w`).join(', ') : undefined,
    sizes: '(max-width: 600px) 100vw, (max-width: 1000px) 50vw, 33vw',
    created_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
  };
});

// ===== Helpers =====

/** Identifies JPEG, PNG, WebP and PDF uploads from their leading bytes rather than trusting the browser. */
function sniff(bytes: Uint8Array) {
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (ascii(1, 3) === 'PNG' && bytes[0] === 0x89) return { mime: 'image/png', ext: 'png' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (ascii(0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  return null;
}

async function fileBytes(value: File | string | null, limit: number, label: string) {
  if (!value || typeof value === 'string') return null;
  if (value.size > limit) throw new HttpError(413, `The ${label} is too large. The maximum is ${limit / 1024 / 1024} MB.`);
  return new Uint8Array(await value.arrayBuffer());
}

async function formBody(request: Request) {
  try { return await request.formData(); } catch { throw new HttpError(400, 'The upload could not be read. Please try again.'); }
}

async function galleryRecords(bucket: R2Bucket | undefined) {
  if (!bucket) return builtInGallery;
  const [keys, hidden] = await Promise.all([listKeys(bucket, 'gallery/'), listKeys(bucket, 'gallery-hidden/')]);
  const uploaded = await Promise.all(keys.filter(key => key.endsWith('.json')).map(key => readJson<GalleryRecord>(bucket, key)));
  const hiddenIds = new Set(hidden.map(key => key.split('/').pop()?.replace(/\.json$/, '')));
  return [...builtInGallery.filter(image => !hiddenIds.has(image.id)), ...uploaded.filter((image): image is GalleryRecord => Boolean(image))]
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

async function allInvoiceRecords(bucket: R2Bucket) {
  const keys = (await listKeys(bucket, 'invoices/')).filter(key => key.endsWith('.json'));
  const invoices = await Promise.all(keys.map(key => readJson<InvoiceRecord>(bucket, key)));
  return invoices.filter((invoice): invoice is InvoiceRecord => Boolean(invoice))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

const invoiceRecords = async (bucket: R2Bucket) => (await allInvoiceRecords(bucket)).slice(0, 200);

/** Validates ?from=yyyy-mm-dd&to=yyyy-mm-dd (at most five years). */
function reportRange(url: URL) {
  const range = z.object({ from: z.string().date(), to: z.string().date() })
    .safeParse({ from: url.searchParams.get('from'), to: url.searchParams.get('to') });
  if (!range.success || range.data.from > range.data.to) throw new HttpError(400, 'Choose a valid date range.');
  if (Date.parse(range.data.to) - Date.parse(range.data.from) > 5 * 366 * 86_400_000) throw new HttpError(400, 'Reports can cover at most five years.');
  return range.data;
}

async function logoBytes(env: Env, request: Request) {
  if (!env.ASSETS) return undefined;
  try {
    const response = await env.ASSETS.fetch(new URL('/images/logo.png', request.url));
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined;
  } catch {
    return undefined;
  }
}

const pdfResponse = (pdf: Uint8Array | ReadableStream, filename: string, status = 200, headers: HeadersInit = {}) =>
  new Response(pdf, {
    status,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
      ...headers,
    },
  });

// ===== Routes =====

/** `renewal` collects headers that extend the session; they are added to whatever response is sent. */
async function route(request: Request, env: Env, renewal: Headers): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  const segments = path.split('/').filter(Boolean).slice(1); // drop "api"

  if (path === '/api/health' && method === 'GET') return json({ status: 'ok' });

  if (path === '/api/gallery' && method === 'GET') {
    return json(await galleryRecords(env.BUCKET), 200, { 'Cache-Control': 'public, max-age=60' });
  }

  if (segments[0] === 'files' && segments[1] === 'gallery' && segments.length === 3 && method === 'GET') {
    const name = segments[2];
    if (!/^[a-f0-9-]{36}\.(webp|jpg|png)$/.test(name) || !env.BUCKET) throw new HttpError(404, 'File was not found.');
    const object = await env.BUCKET.get(`gallery/${name}`);
    if (!object) throw new HttpError(404, 'File was not found.');
    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
        ETag: object.httpEtag,
      },
    });
  }

  if (segments[0] !== 'admin') throw new HttpError(404, 'Not found.');

  const config = adminConfig(env, request);
  const bucket = config.bucket;
  assertSameOrigin(request);

  if (path === '/api/admin/login' && method === 'POST') {
    assertNotThrottled(request);
    const input = z.object({ password: z.string().min(1).max(256) }).safeParse(await jsonBody(request));
    if (!input.success) throw new HttpError(400, 'Enter the admin password.');
    if (!passwordMatches(input.data.password, config)) {
      recordAttempt(request, false);
      throw new HttpError(401, 'The password is incorrect.');
    }
    recordAttempt(request, true);
    const { cookie, expiresAt } = await sessionCookie(request, config);
    return json({ authenticated: true, expiresAt }, 200, { 'Set-Cookie': cookie });
  }

  if (path === '/api/admin/session' && method === 'GET') {
    const session = await readSession(request, config);
    if (!session) return json({ authenticated: false, expiresAt: null });
    const renewed = await sessionCookie(request, config, session.issuedAt);
    return json({ authenticated: true, expiresAt: renewed.expiresAt }, 200, { 'Set-Cookie': renewed.cookie, 'X-Session-Expires': String(renewed.expiresAt) });
  }

  if (path === '/api/admin/logout' && method === 'POST') return noContent({ 'Set-Cookie': clearedSessionCookie(request) });

  const session = await requireAdmin(request, config);
  // Activity keeps the session alive: every signed-in request restarts the 30-minute idle timer.
  const renewed = await sessionCookie(request, config, session.issuedAt);
  renewal.append('Set-Cookie', renewed.cookie);
  renewal.set('X-Session-Expires', String(renewed.expiresAt));

  if (segments[1] === 'menu') {
    const response = await menuRoutes(request, bucket, path);
    if (response) return response;
  }
  if (segments[1] === 'tabs') {
    const response = await tabRoutes(request, bucket, segments);
    if (response) return response;
  }

  if (path === '/api/admin/gallery' && method === 'GET') return json(await galleryRecords(bucket));

  if (path === '/api/admin/gallery' && method === 'POST') {
    const form = await formBody(request);
    const fields = z.object({
      altText: z.string().trim().min(3).max(180),
      category: z.enum(categories),
    }).safeParse({ altText: form.get('altText'), category: form.get('category') });
    const bytes = await fileBytes(form.get('image'), maxImageBytes, 'photo');
    if (!fields.success || !bytes) throw new HttpError(400, 'Choose an image and provide its description and collection.');
    const type = sniff(bytes);
    if (!type || type.mime === 'application/pdf') throw new HttpError(415, 'Only JPG, PNG, or WebP images are accepted.');

    const id = crypto.randomUUID();
    const imageKey = `gallery/${id}.${type.ext}`;
    await bucket.put(imageKey, bytes, { httpMetadata: { contentType: type.mime, cacheControl: 'public, max-age=31536000, immutable' } });
    const record: GalleryRecord = {
      id,
      alt_text: fields.data.altText,
      category: fields.data.category,
      image_url: `/api/files/gallery/${id}.${type.ext}`,
      image_key: imageKey,
      created_at: new Date().toISOString(),
    };
    try {
      await putJson(bucket, `gallery/${id}.json`, record);
    } catch (error) {
      await bucket.delete(imageKey);
      throw error;
    }
    return json(record, 201);
  }

  if (segments[1] === 'gallery' && segments.length === 3 && method === 'DELETE') {
    const id = z.string().regex(/^[a-z0-9-]{1,80}$/).safeParse(segments[2]);
    if (!id.success) throw new HttpError(400, 'Invalid gallery image.');
    if (builtInGallery.some(image => image.id === id.data)) {
      await putJson(bucket, `gallery-hidden/${id.data}.json`, { id: id.data });
      return noContent();
    }
    const metadataKey = `gallery/${id.data}.json`;
    const image = await requireJson<GalleryRecord>(bucket, metadataKey, 'Gallery image was not found.');
    await bucket.delete([metadataKey, ...(image.image_key ? [image.image_key] : [])]);
    return noContent();
  }

  if (path === '/api/admin/invoices' && method === 'GET') {
    const invoices = await invoiceRecords(bucket);
    return json(invoices.map(({ pdf_key: _pdf, source_bill_key: _source, line_items: _lines, ...invoice }) => invoice));
  }

  if (path === '/api/admin/reports' && method === 'GET') {
    const { from, to } = reportRange(url);
    const [invoices, menu] = await Promise.all([allInvoiceRecords(bucket), loadMenu(bucket)]);
    return json(buildReport(invoices, menu, from, to));
  }

  if (path === '/api/admin/reports/pdf' && method === 'GET') {
    const { from, to } = reportRange(url);
    const [invoices, menu, logo] = await Promise.all([allInvoiceRecords(bucket), loadMenu(bucket), logoBytes(env, request)]);
    return pdfResponse(await buildReportPdf(buildReport(invoices, menu, from, to), logo), `mandarin-orchid-report-${from}-to-${to}.pdf`);
  }

  if (segments[1] === 'invoices' && segments.length === 4 && segments[3] === 'download' && method === 'GET') {
    const id = z.string().uuid().safeParse(segments[2]);
    if (!id.success) throw new HttpError(400, 'Invalid invoice.');
    const invoice = await requireJson<InvoiceRecord>(bucket, `invoices/${id.data}.json`, 'Invoice was not found.');
    const pdf = await bucket.get(invoice.pdf_key);
    if (!pdf) throw new HttpError(404, 'The invoice PDF could not be found.');
    return pdfResponse(pdf.body, `${invoice.invoice_number}.pdf`);
  }

  // Deleting a billing record requires the admin password again, not just a valid session.
  if (segments[1] === 'invoices' && segments.length === 3 && method === 'DELETE') {
    const id = z.string().uuid().safeParse(segments[2]);
    const input = z.object({ password: z.string().min(1).max(256) }).safeParse(await jsonBody(request));
    if (!id.success || !input.success) throw new HttpError(400, 'Enter the admin password to confirm.');
    assertNotThrottled(request);
    // 403 rather than 401: a wrong confirmation password must not end the session.
    if (!passwordMatches(input.data.password, config)) {
      recordAttempt(request, false);
      throw new HttpError(403, 'The password is incorrect. The invoice was not removed.');
    }
    const metadataKey = `invoices/${id.data}.json`;
    const invoice = await requireJson<InvoiceRecord>(bucket, metadataKey, 'Invoice was not found.');
    await bucket.delete([metadataKey, invoice.pdf_key, ...(invoice.source_bill_key ? [invoice.source_bill_key] : [])]);
    return noContent();
  }

  if (path === '/api/admin/invoices' && method === 'POST') return saveInvoice(request, env, bucket, null);

  if (segments[1] === 'invoices' && segments.length === 3 && (method === 'GET' || method === 'PUT')) {
    const id = z.string().uuid().safeParse(segments[2]);
    if (!id.success) throw new HttpError(400, 'Invalid invoice.');
    const invoice = await requireJson<InvoiceRecord>(bucket, `invoices/${id.data}.json`, 'Invoice was not found.');
    if (method === 'PUT') return saveInvoice(request, env, bucket, invoice);
    const { pdf_key: _pdf, source_bill_key: sourceBill, ...rest } = invoice;
    return json({ ...rest, has_source_bill: Boolean(sourceBill) });
  }

  throw new HttpError(404, 'Not found.');
}

const invoiceInput = z.object({
  guestName: z.string().trim().min(1).max(140),
  guestEmail: z.union([z.string().email().max(254), z.literal('')]).optional(),
  stayStart: z.string().date(),
  stayEnd: z.string().date(),
  stayLabel: z.string().trim().max(60).optional(),
  tabId: z.string().uuid().optional(),
  taxRate: z.coerce.number().min(0).max(100).default(0),
  advancePaid: z.coerce.number().min(0).max(9_999_999_999).default(0),
  lineItems: z.string().transform((value, context) => {
    try { return JSON.parse(value) as unknown; }
    catch {
      context.addIssue({ code: 'custom', message: 'Bill items must be valid JSON.' });
      return [];
    }
  }).pipe(lineSchema),
});

/**
 * Creates a new invoice, or revises `existing` in place: same id, number and issue
 * date, a regenerated PDF, and an incremented revision number.
 */
async function saveInvoice(request: Request, env: Env, bucket: R2Bucket, existing: InvoiceRecord | null) {
  const form = await formBody(request);
  const input = invoiceInput.safeParse({
    guestName: form.get('guestName'),
    guestEmail: form.get('guestEmail') ?? '',
    stayStart: form.get('stayStart'),
    stayEnd: form.get('stayEnd'),
    stayLabel: form.get('stayLabel') ?? undefined,
    tabId: form.get('tabId') || undefined,
    taxRate: form.get('taxRate') ?? 0,
    advancePaid: form.get('advancePaid') || 0,
    lineItems: form.get('lineItems'),
  });
  if (!input.success) throw new HttpError(400, 'Check the guest, stay dates, tax rate, advance and bill items.');
  if (input.data.stayEnd < input.data.stayStart) throw new HttpError(400, 'Check-out must be on or after check-in.');

  const sourceBill = await fileBytes(form.get('sourceBill'), maxBillBytes, 'attached bill');
  if (sourceBill && sniff(sourceBill)?.mime !== 'application/pdf') throw new HttpError(415, 'The attached source bill must be a valid PDF.');

  const lineItems = input.data.lineItems as InvoiceLine[];
  const totals = calculateTotals(lineItems, input.data.taxRate);
  if (!Number.isFinite(totals.total) || totals.total > 9_999_999_999.99) throw new HttpError(400, 'The invoice total exceeds the supported maximum.');
  const advancePaid = Math.round(input.data.advancePaid * 100) / 100;
  if (advancePaid > totals.total) throw new HttpError(400, 'The advance paid is more than the invoice total.');

  const id = existing?.id || crypto.randomUUID();
  const invoiceNumber = existing?.invoice_number || `MO-${new Date().getFullYear()}-${id.slice(0, 12).toUpperCase()}`;
  const createdAt = existing ? new Date(existing.created_at) : new Date();
  const now = new Date();
  const revision = existing ? (existing.revision || 0) + 1 : 0;
  const pdfKey = existing?.pdf_key || `invoices/${id}.pdf`;
  const sourceBillKey = sourceBill ? `invoices/${id}-source.pdf` : existing?.source_bill_key || null;
  const pdf = await buildInvoicePdf({
    invoiceNumber,
    issueDate: createdAt,
    revisedAt: revision ? now : undefined,
    guestName: input.data.guestName,
    guestEmail: input.data.guestEmail || undefined,
    stayStart: new Date(`${input.data.stayStart}T00:00:00+05:30`),
    stayEnd: new Date(`${input.data.stayEnd}T00:00:00+05:30`),
    stayLabel: input.data.stayLabel || undefined,
    taxRate: input.data.taxRate,
    advancePaid,
    lineItems,
    logoPng: await logoBytes(env, request),
  });

  const saved: string[] = [];
  try {
    await bucket.put(pdfKey, pdf, { httpMetadata: { contentType: 'application/pdf' } });
    if (!existing) saved.push(pdfKey);
    if (sourceBill && sourceBillKey) {
      await bucket.put(sourceBillKey, sourceBill, { httpMetadata: { contentType: 'application/pdf' } });
      if (!existing) saved.push(sourceBillKey);
    }
    const record: InvoiceRecord = {
      id,
      invoice_number: invoiceNumber,
      guest_name: input.data.guestName,
      guest_email: input.data.guestEmail || null,
      total_amount: totals.total,
      currency: 'INR',
      created_at: createdAt.toISOString(),
      pdf_key: pdfKey,
      source_bill_key: sourceBillKey,
      stay_label: input.data.stayLabel || null,
      stay_start: input.data.stayStart,
      stay_end: input.data.stayEnd,
      subtotal: totals.subtotal,
      tax_amount: totals.taxAmount,
      tax_rate: input.data.taxRate,
      advance_paid: advancePaid,
      balance_due: Math.round((totals.total - advancePaid) * 100) / 100,
      line_items: lineItems.map(({ description, quantity, unitPrice, section, itemId }) => ({
        description, quantity, unitPrice, ...(section ? { section } : {}), ...(itemId ? { itemId } : {}),
      })),
      tab_id: existing ? existing.tab_id ?? null : input.data.tabId || null,
      revision,
      updated_at: now.toISOString(),
    };
    await putJson(bucket, `invoices/${id}.json`, record);
  } catch (error) {
    if (saved.length) await bucket.delete(saved);
    throw error;
  }
  if (!existing && input.data.tabId) {
    // The invoice is already saved; a failure here only leaves the tab open for staff to close.
    await closeTab(bucket, input.data.tabId, { id, number: invoiceNumber }).catch(error => console.error('Could not close tab', error));
  }
  return pdfResponse(pdf, `${invoiceNumber}.pdf`, existing ? 200 : 201, { 'X-Invoice-Number': invoiceNumber });
}

/** Entry point for every /api request. */
export async function handleApi(request: Request, env: Env): Promise<Response> {
  let response: Response;
  const renewal = new Headers();
  try {
    response = await route(request, env, renewal);
  } catch (error) {
    if (error instanceof HttpError) response = json({ error: error.message }, error.status, error.headers);
    else {
      console.error(error);
      response = json({ error: 'Unexpected server error.' }, 500);
    }
  }
  const headers = new Headers(response.headers);
  renewal.forEach((value, name) => headers.append(name, value));
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'same-origin');
  if (new URL(request.url).pathname.startsWith('/api/admin')) {
    headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
