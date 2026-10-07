/// <reference types="@cloudflare/workers-types" />
import { z } from 'zod';
import { assertSameOrigin } from './auth.js';
import { HttpError } from './env.js';
import { json, jsonBody, noContent, updateJson } from './http.js';
import { listKeys, putJson, readJson, requireJson } from './storage.js';

export type EnquiryStatus = 'new' | 'contacted' | 'booked' | 'closed';
export type Enquiry = {
  id: string;
  /** Where it came from: the contact page form or the homepage booking bar. */
  source: 'contact' | 'booking';
  name: string;
  email: string;
  phone: string;
  check_in: string;
  check_out: string;
  room: string;
  guests: string;
  message: string;
  status: EnquiryStatus;
  /** Private note for the team; never shown to guests. */
  note: string;
  created_at: string;
  updated_at: string;
};

const enquiryKey = (id: string) => `enquiries/${id}.json`;
const maxNew = 500;
const minFillMs = 2500;
const perVisitorLimit = 6;
const perVisitorWindow = 60 * 60 * 1000;
const recentSubmissions = new Map<string, number[]>();

const clean = (text: string) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim();
const text = (max: number) => z.string().transform(clean).pipe(z.string().max(max)).optional().default('');
const isoDate = z.union([z.string().date(), z.literal('')]).optional().default('');

const submission = z.object({
  source: z.enum(['contact', 'booking']),
  name: text(80),
  email: z.union([z.string().trim().email().max(254), z.literal('')]).optional().default(''),
  phone: z.string().transform(clean).pipe(z.string().max(30).regex(/^[0-9+()\-\s]*$/)).optional().default(''),
  checkIn: isoDate,
  checkOut: isoDate,
  room: text(60),
  guests: text(30),
  message: text(2000),
  website: z.string().optional().default(''),
  elapsedMs: z.number().min(0).optional().default(0),
});

async function allEnquiries(bucket: R2Bucket) {
  const records = await Promise.all((await listKeys(bucket, 'enquiries/')).map(key => readJson<Enquiry>(bucket, key)));
  return records.filter((record): record is Enquiry => Boolean(record));
}

/** POST /api/enquiries from the contact form or booking bar. */
export async function publicEnquiryRoutes(request: Request, bucket: R2Bucket | undefined) {
  if (request.method !== 'POST') return null;
  if (!bucket) throw new HttpError(503, 'Enquiries are not available right now.');
  assertSameOrigin(request);
  const input = submission.safeParse(await jsonBody(request));
  if (!input.success) throw new HttpError(400, 'Please check your details and try again.');
  const data = input.data;
  if (data.source === 'contact' && (data.name.length < 2 || (!data.email && !data.phone))) {
    throw new HttpError(400, 'Please add your name and an email or phone number.');
  }
  if (data.checkIn && data.checkOut && data.checkOut < data.checkIn) throw new HttpError(400, 'Check-out must be after check-in.');
  // Bots fill hidden fields and submit instantly: accept politely but keep nothing.
  if (data.website || data.elapsedMs < minFillMs) return json({ received: true }, 201);

  const visitor = request.headers.get('cf-connecting-ip') || 'local';
  const now = Date.now();
  const recent = (recentSubmissions.get(visitor) || []).filter(time => now - time < perVisitorWindow);
  if (recent.length >= perVisitorLimit) throw new HttpError(429, 'Thank you! We already have your enquiries and will be in touch soon.');
  const unread = (await allEnquiries(bucket)).filter(enquiry => enquiry.status === 'new').length;
  if (unread >= maxNew) throw new HttpError(429, 'Please message us on WhatsApp and we will help you right away.');

  const created = new Date().toISOString();
  const enquiry: Enquiry = {
    id: crypto.randomUUID(),
    source: data.source,
    name: data.name,
    email: data.email,
    phone: data.phone,
    check_in: data.checkIn,
    check_out: data.checkOut,
    room: data.room,
    guests: data.guests,
    message: data.message,
    status: 'new',
    note: '',
    created_at: created,
    updated_at: created,
  };
  await putJson(bucket, enquiryKey(enquiry.id), enquiry);
  recentSubmissions.set(visitor, [...recent, now]);
  return json({ received: true }, 201);
}

/** /api/admin/enquiries[/:id] for the dashboard. */
export async function adminEnquiryRoutes(request: Request, bucket: R2Bucket, segments: string[]) {
  const [, , id] = segments;
  if (!id && request.method === 'GET') {
    const enquiries = (await allEnquiries(bucket)).sort((a, b) => b.created_at.localeCompare(a.created_at));
    return json({ enquiries });
  }
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return null;

  if (request.method === 'PATCH') {
    const input = z.object({
      status: z.enum(['new', 'contacted', 'booked', 'closed']).optional(),
      note: z.string().transform(clean).pipe(z.string().max(1000)).optional(),
    }).safeParse(await jsonBody(request));
    if (!input.success) throw new HttpError(400, 'Check the status and note.');
    const updated = await updateJson<Enquiry>(bucket, enquiryKey(id), 'This enquiry was not found.', current => ({
      ...current,
      status: input.data.status ?? current.status,
      note: input.data.note ?? current.note,
      updated_at: new Date().toISOString(),
    }));
    return json(updated);
  }

  if (request.method === 'DELETE') {
    await requireJson<Enquiry>(bucket, enquiryKey(id), 'This enquiry was not found.');
    await bucket.delete(enquiryKey(id));
    return noContent();
  }
  return null;
}
