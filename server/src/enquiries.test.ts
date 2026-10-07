import assert from 'node:assert/strict';
import test from 'node:test';
import { handleApi } from './app.js';
import { fakeBucket } from './fakeBucket.js';

const base = 'http://localhost:8788';

async function setup() {
  const { bucket, objects } = fakeBucket();
  const env = { BUCKET: bucket };
  const login = await handleApi(new Request(`${base}/api/admin/login`, { method: 'POST', body: JSON.stringify({ password: 'mandarin-local-password' }) }), env);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const admin = (path: string, init: RequestInit = {}) => handleApi(new Request(`${base}${path}`, { ...init, headers: { cookie, ...init.headers } }), env);
  const send = (body: Record<string, unknown>, visitor = 'guest', origin = base) => handleApi(new Request(`${base}/api/enquiries`, {
    method: 'POST', body: JSON.stringify({ elapsedMs: 10_000, ...body }), headers: { origin, 'cf-connecting-ip': visitor },
  }), env);
  return { admin, send, objects };
}

type List = { enquiries: { id: string; source: string; name: string; status: string; note: string; check_in: string; room: string }[] };

test('saves contact and booking enquiries for the dashboard', async () => {
  const { admin, send } = await setup();
  assert.equal((await send({ source: 'contact', name: 'Kavya Iyer', email: 'kavya@example.com', phone: '+91 98765 43210', checkIn: '2026-12-20', checkOut: '2026-12-23', room: 'Villa', guests: '4 Guests', message: 'Family trip, any campfire?' })).status, 201);
  assert.equal((await send({ source: 'booking', room: 'Villa Room', checkIn: '2026-11-02', checkOut: '2026-11-04', guests: '2 Guests' }, 'other')).status, 201);

  const list = await (await admin('/api/admin/enquiries')).json() as List;
  assert.equal(list.enquiries.length, 2);
  assert.deepEqual(list.enquiries.map(item => item.status), ['new', 'new']);
  const kavya = list.enquiries.find(item => item.name === 'Kavya Iyer')!;
  assert.equal(kavya.check_in, '2026-12-20');

  const updated = await (await admin(`/api/admin/enquiries/${kavya.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'contacted', note: 'Called, sending quote' }) })).json() as List['enquiries'][number];
  assert.deepEqual([updated.status, updated.note], ['contacted', 'Called, sending quote']);
  assert.equal((await admin(`/api/admin/enquiries/${kavya.id}`, { method: 'DELETE' })).status, 204);
  assert.equal(((await (await admin('/api/admin/enquiries')).json()) as List).enquiries.length, 1);
});

test('validates contact details and blocks spam', async () => {
  const { send, objects } = await setup();
  assert.equal((await send({ source: 'contact', name: 'K' , email: 'k@example.com' })).status, 400);
  assert.equal((await send({ source: 'contact', name: 'Kavya' })).status, 400, 'needs an email or phone');
  assert.equal((await send({ source: 'contact', name: 'Kavya', email: 'not-an-email' })).status, 400);
  assert.equal((await send({ source: 'booking', checkIn: '2026-11-05', checkOut: '2026-11-01' })).status, 400);
  assert.equal((await send({ source: 'booking', room: 'Villa' }, 'x', 'https://evil.example')).status, 403);
  assert.equal((await send({ source: 'booking', room: 'Villa', website: 'spam' }, 'bot')).status, 201);
  assert.equal((await send({ source: 'booking', room: 'Villa', elapsedMs: 100 }, 'bot')).status, 201);
  assert.equal([...objects.keys()].filter(key => key.startsWith('enquiries/')).length, 0, 'bots are not stored');
  for (let i = 0; i < 6; i++) assert.equal((await send({ source: 'booking', room: 'Villa' }, 'busy')).status, 201);
  assert.equal((await send({ source: 'booking', room: 'Villa' }, 'busy')).status, 429);
});

test('the enquiry list needs the admin session', async () => {
  const { bucket } = fakeBucket();
  assert.equal((await handleApi(new Request(`${base}/api/admin/enquiries`), { BUCKET: bucket })).status, 401);
});
