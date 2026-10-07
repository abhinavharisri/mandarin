import assert from 'node:assert/strict';
import test from 'node:test';
import { handleApi } from './app.js';
import { fakeBucket } from './fakeBucket.js';

const base = 'http://localhost:8788';
const password = JSON.stringify({ password: 'mandarin-local-password' });

async function setup() {
  const { bucket, objects } = fakeBucket();
  const env = { BUCKET: bucket };
  const login = await handleApi(new Request(`${base}/api/admin/login`, { method: 'POST', body: password }), env);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const call = (path: string, init: RequestInit = {}) => handleApi(new Request(`${base}${path}`, { ...init, headers: { cookie, ...init.headers } }), env);
  const create = async (guestName: string) => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ guestName, stayStart: '2026-10-02', stayEnd: '2026-10-04', stayLabel: 'Villa 1', lineItems: JSON.stringify([{ description: 'Rent', quantity: 1, unitPrice: 35000 }]) })) form.set(key, value);
    const response = await call('/api/admin/invoices', { method: 'POST', body: form });
    const number = response.headers.get('X-Invoice-Number')!;
    const list = await (await call('/api/admin/invoices')).json() as { id: string; invoice_number: string }[];
    return { id: list.find(invoice => invoice.invoice_number === number)!.id, number };
  };
  const report = async () => (await (await call('/api/admin/reports?from=2026-01-01&to=2026-12-31')).json() as { totals: { invoices: number } }).totals.invoices;
  return { call, create, objects, report };
}

test('deleting moves an invoice to Recently deleted, and restoring brings it back unchanged', async () => {
  const { call, create, objects, report } = await setup();
  const { id, number } = await create('Ananya Raman');
  assert.equal(await report(), 1);

  assert.equal((await call(`/api/admin/invoices/${id}`, { method: 'DELETE', body: JSON.stringify({ password: 'wrong' }) })).status, 403);
  assert.equal((await call(`/api/admin/invoices/${id}`, { method: 'DELETE', body: password })).status, 204);

  assert.deepEqual(await (await call('/api/admin/invoices')).json(), []);
  assert.equal(await report(), 0);
  assert.equal((await call(`/api/admin/invoices/${id}/download`)).status, 404);
  assert.ok(objects.has(`invoices/${id}.pdf`), 'the PDF is kept while in the bin');

  const bin = await (await call('/api/admin/trash')).json() as { retention_days: number; items: { id: string; invoice_number: string; expires_at: string }[] };
  assert.equal(bin.retention_days, 30);
  assert.deepEqual(bin.items.map(item => item.invoice_number), [number]);
  assert.equal('pdf_key' in bin.items[0], false);
  const fromBin = await call(`/api/admin/trash/${id}/download`);
  assert.equal(fromBin.status, 200);
  assert.equal(fromBin.headers.get('Content-Type'), 'application/pdf');

  assert.equal((await call(`/api/admin/trash/${id}/restore`, { method: 'POST' })).status, 200);
  const restored = await (await call('/api/admin/invoices')).json() as { id: string; invoice_number: string }[];
  assert.deepEqual(restored.map(invoice => [invoice.id, invoice.invoice_number]), [[id, number]]);
  assert.equal((await call(`/api/admin/invoices/${id}/download`)).status, 200);
  assert.equal(await report(), 1);
  assert.equal(((await (await call('/api/admin/trash')).json()) as { items: unknown[] }).items.length, 0);
});

test('deleting forever needs the password and removes the PDF', async () => {
  const { call, create, objects } = await setup();
  const first = await create('First');
  const second = await create('Second');
  const third = await create('Third');
  for (const { id } of [first, second, third]) await call(`/api/admin/invoices/${id}`, { method: 'DELETE', body: password });

  assert.equal((await call(`/api/admin/trash/${first.id}`, { method: 'DELETE', body: JSON.stringify({ password: 'nope' }) })).status, 403);
  assert.ok(objects.has(`invoices/${first.id}.pdf`));
  assert.equal((await call(`/api/admin/trash/${first.id}`, { method: 'DELETE', body: password })).status, 204);
  assert.equal(objects.has(`invoices/${first.id}.pdf`), false);
  assert.equal((await call(`/api/admin/trash/${first.id}/restore`, { method: 'POST' })).status, 404);

  assert.equal((await call('/api/admin/trash', { method: 'DELETE', body: JSON.stringify({ password: 'nope' }) })).status, 403);
  const emptied = await (await call('/api/admin/trash', { method: 'DELETE', body: password })).json() as { deleted: number };
  assert.equal(emptied.deleted, 2);
  assert.equal([...objects.keys()].some(key => key.endsWith('.pdf')), false);
});

test('invoices older than 30 days in the bin are removed for good', async () => {
  const { call, create, objects } = await setup();
  const old = await create('Old');
  const recent = await create('Recent');
  for (const { id } of [old, recent]) await call(`/api/admin/invoices/${id}`, { method: 'DELETE', body: password });
  const key = `trash/invoices/${old.id}.json`;
  const record = JSON.parse(objects.get(key)!.body);
  objects.set(key, { ...objects.get(key)!, body: JSON.stringify({ ...record, deleted_at: new Date(Date.now() - 31 * 86_400_000).toISOString() }) });

  const bin = await (await call('/api/admin/trash')).json() as { items: { id: string }[] };
  assert.deepEqual(bin.items.map(item => item.id), [recent.id]);
  assert.equal(objects.has(key), false);
  assert.equal(objects.has(`invoices/${old.id}.pdf`), false);
  assert.ok(objects.has(`invoices/${recent.id}.pdf`));
});
