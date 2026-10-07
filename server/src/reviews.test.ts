import assert from 'node:assert/strict';
import test from 'node:test';
import { handleApi } from './app.js';
import { fakeBucket } from './fakeBucket.js';

const base = 'http://localhost:8788';
type PublicReviews = { summary: { average: number; count: number; distribution: Record<string, number> }; reviews: { id: string; name: string; rating: number; featured: boolean; text: string }[] };

async function setup() {
  const { bucket, objects } = fakeBucket();
  const env = { BUCKET: bucket };
  const login = await handleApi(new Request(`${base}/api/admin/login`, { method: 'POST', body: JSON.stringify({ password: 'mandarin-local-password' }) }), env);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const admin = (path: string, init: RequestInit = {}) => handleApi(new Request(`${base}${path}`, { ...init, headers: { cookie, ...init.headers } }), env);
  const submit = (body: Record<string, unknown>, visitor = 'guest-1', origin = base) => handleApi(new Request(`${base}/api/reviews`, {
    method: 'POST', body: JSON.stringify({ elapsedMs: 20_000, ...body }), headers: { origin, 'cf-connecting-ip': visitor },
  }), env);
  const published = async () => (await (await handleApi(new Request(`${base}/api/reviews`), env)).json()) as PublicReviews;
  return { admin, submit, published, objects };
}

const review = { name: 'Kavya Iyer', rating: 5, text: 'Lovely villa, warm staff and the best dosai in Kotagiri.', stay: 'Villa 2', visited: '2026-10' };

test('new reviews wait for approval, then appear with the right summary', async () => {
  const { admin, submit, published } = await setup();
  assert.equal((await submit(review, 'a')).status, 201);
  assert.equal((await submit({ ...review, name: 'Rohan', rating: 4, text: 'Peaceful, clean and great food overall.' }, 'b')).status, 201);
  assert.equal((await published()).reviews.length, 0, 'nothing is public before approval');

  const queue = await (await admin('/api/admin/reviews')).json() as { reviews: { id: string; name: string; status: string }[] };
  assert.deepEqual(queue.reviews.map(item => item.status), ['pending', 'pending']);
  for (const item of queue.reviews) await admin(`/api/admin/reviews/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'approved' }) });

  const rohan = queue.reviews.find(item => item.name === 'Rohan')!;
  await admin(`/api/admin/reviews/${rohan.id}`, { method: 'PATCH', body: JSON.stringify({ featured: true }) });
  const live = await published();
  assert.equal(live.reviews[0].name, 'Rohan', 'featured reviews come first');
  assert.deepEqual(live.summary, { average: 4.5, count: 2, distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 1 } });
  assert.equal('status' in live.reviews[0], false);

  await admin(`/api/admin/reviews/${rohan.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'hidden' }) });
  assert.deepEqual((await published()).reviews.map(item => item.name), ['Kavya Iyer']);
  assert.equal((await admin(`/api/admin/reviews/${rohan.id}`, { method: 'DELETE' })).status, 204);
});

test('drops bots quietly and blocks cross-site or repeated submissions', async () => {
  const { submit, objects } = await setup();
  assert.equal((await submit({ ...review, website: 'http://spam.example' }, 'bot-1')).status, 201);
  assert.equal((await submit({ ...review, elapsedMs: 300 }, 'bot-2')).status, 201);
  assert.equal([...objects.keys()].filter(key => key.startsWith('reviews/')).length, 0, 'bot submissions are not stored');

  assert.equal((await submit(review, 'x', 'https://evil.example')).status, 403);
  assert.equal((await submit({ ...review, rating: 6 }, 'y')).status, 400);
  assert.equal((await submit({ ...review, text: 'Too short' }, 'y')).status, 400);

  for (let i = 0; i < 3; i++) assert.equal((await submit(review, 'repeat')).status, 201);
  assert.equal((await submit(review, 'repeat')).status, 429);
});

test('moderation needs the admin session', async () => {
  const { bucket } = fakeBucket();
  const response = await handleApi(new Request(`${base}/api/admin/reviews`), { BUCKET: bucket });
  assert.equal(response.status, 401);
});
