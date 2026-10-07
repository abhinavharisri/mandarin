/// <reference types="@cloudflare/workers-types" />
import { z } from 'zod';
import { assertSameOrigin } from './auth.js';
import { HttpError } from './env.js';
import { json, jsonBody, noContent } from './http.js';
import { listKeys, putJson, readJson, requireJson } from './storage.js';

export type ReviewStatus = 'pending' | 'approved' | 'hidden';
export type Review = {
  id: string;
  name: string;
  rating: number;
  text: string;
  /** Optional: where they stayed, e.g. "Villa 2". */
  stay: string;
  /** Optional: when they visited, yyyy-mm. */
  visited: string;
  status: ReviewStatus;
  featured: boolean;
  created_at: string;
  updated_at: string;
};

const reviewKey = (id: string) => `reviews/${id}.json`;
const maxPending = 300;
const minFillMs = 3000;
const perVisitorLimit = 3;
const perVisitorWindow = 60 * 60 * 1000;
const recentSubmissions = new Map<string, number[]>();

/** Strips control characters and collapses runs of blank lines. */
const clean = (text: string) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim();

const submission = z.object({
  name: z.string().transform(clean).pipe(z.string().min(2).max(60)),
  rating: z.number().int().min(1).max(5),
  text: z.string().transform(clean).pipe(z.string().min(10).max(1500)),
  stay: z.string().transform(clean).pipe(z.string().max(60)).optional().default(''),
  visited: z.union([z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), z.literal('')]).optional().default(''),
  /** Honeypot: hidden from people, filled in by bots. */
  website: z.string().optional().default(''),
  /** Milliseconds between the form appearing and being sent. */
  elapsedMs: z.number().min(0).optional().default(0),
});

async function allReviews(bucket: R2Bucket) {
  const reviews = await Promise.all((await listKeys(bucket, 'reviews/')).map(key => readJson<Review>(bucket, key)));
  return reviews.filter((review): review is Review => Boolean(review));
}

const publicView = ({ id, name, rating, text, stay, visited, featured, created_at }: Review) => ({ id, name, rating, text, stay, visited, featured, created_at });

export function summarise(reviews: Review[]) {
  const approved = reviews.filter(review => review.status === 'approved');
  const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
  for (const review of approved) distribution[review.rating as 1 | 2 | 3 | 4 | 5] += 1;
  const average = approved.length ? Math.round((approved.reduce((sum, review) => sum + review.rating, 0) / approved.length) * 10) / 10 : 0;
  return { average, count: approved.length, distribution };
}

/** Featured first, then newest. */
const byPublicOrder = (a: Review, b: Review) => Number(b.featured) - Number(a.featured) || b.created_at.localeCompare(a.created_at);

/** Public routes: /api/reviews (GET published, POST a new review for approval). */
export async function publicReviewRoutes(request: Request, bucket: R2Bucket | undefined) {
  if (!bucket) throw new HttpError(503, 'Reviews are not available right now.');

  if (request.method === 'GET') {
    const reviews = await allReviews(bucket);
    return json({ summary: summarise(reviews), reviews: reviews.filter(review => review.status === 'approved').sort(byPublicOrder).map(publicView) }, 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  if (request.method === 'POST') {
    assertSameOrigin(request);
    const input = submission.safeParse(await jsonBody(request));
    if (!input.success) throw new HttpError(400, 'Please add your name, a star rating and a review of at least 10 characters.');
    // Bots fill hidden fields and submit instantly: accept politely but keep nothing.
    if (input.data.website || input.data.elapsedMs < minFillMs) return json({ status: 'pending' }, 201);

    const visitor = request.headers.get('cf-connecting-ip') || 'local';
    const now = Date.now();
    const recent = (recentSubmissions.get(visitor) || []).filter(time => now - time < perVisitorWindow);
    if (recent.length >= perVisitorLimit) throw new HttpError(429, 'Thank you! You have already sent a few reviews. Please try again later.');
    const pending = (await allReviews(bucket)).filter(review => review.status === 'pending').length;
    if (pending >= maxPending) throw new HttpError(429, 'We are not accepting new reviews right now. Please try again later.');

    const created = new Date().toISOString();
    const review: Review = {
      id: crypto.randomUUID(),
      name: input.data.name,
      rating: input.data.rating,
      text: input.data.text,
      stay: input.data.stay,
      visited: input.data.visited,
      status: 'pending',
      featured: false,
      created_at: created,
      updated_at: created,
    };
    await putJson(bucket, reviewKey(review.id), review);
    recentSubmissions.set(visitor, [...recent, now]);
    return json({ status: 'pending' }, 201);
  }

  return null;
}

/** Admin routes: /api/admin/reviews[/:id] to moderate. */
export async function adminReviewRoutes(request: Request, bucket: R2Bucket, segments: string[]) {
  const [, , id] = segments;
  if (!id && request.method === 'GET') {
    const reviews = await allReviews(bucket);
    const order = { pending: 0, approved: 1, hidden: 2 } as const;
    return json({
      summary: summarise(reviews),
      reviews: reviews.sort((a, b) => order[a.status] - order[b.status] || byPublicOrder(a, b)),
    });
  }
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return null;

  if (request.method === 'PATCH') {
    const input = z.object({ status: z.enum(['pending', 'approved', 'hidden']).optional(), featured: z.boolean().optional() }).safeParse(await jsonBody(request));
    if (!input.success) throw new HttpError(400, 'Choose approve, hide or feature.');
    const review = await requireJson<Review>(bucket, reviewKey(id), 'This review was not found.');
    const status = input.data.status ?? review.status;
    const updated: Review = {
      ...review,
      status,
      // Only published reviews can be featured.
      featured: status === 'approved' ? input.data.featured ?? review.featured : false,
      updated_at: new Date().toISOString(),
    };
    await putJson(bucket, reviewKey(id), updated);
    return json(updated);
  }

  if (request.method === 'DELETE') {
    await requireJson<Review>(bucket, reviewKey(id), 'This review was not found.');
    await bucket.delete(reviewKey(id));
    return noContent();
  }
  return null;
}
