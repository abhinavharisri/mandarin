import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { handleApi } from './app.js';
import { fakeBucket } from './fakeBucket.js';

const base = 'http://localhost:8788';

async function signedIn() {
  const { bucket, objects } = fakeBucket();
  const env = { BUCKET: bucket };
  const login = await handleApi(new Request(`${base}/api/admin/login`, { method: 'POST', body: JSON.stringify({ password: 'mandarin-local-password' }), headers: { 'Content-Type': 'application/json' } }), env);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const call = (path: string, init: RequestInit = {}) => handleApi(new Request(`${base}${path}`, { ...init, headers: { cookie, ...init.headers } }), env);
  return { call, objects };
}

const invoiceForm = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
};

const lines = (items: unknown[]) => JSON.stringify(items);

test('creates, reopens and revises an invoice with half portions and an advance', async () => {
  const { call } = await signedIn();
  const created = await call('/api/admin/invoices', { method: 'POST', body: invoiceForm({
    guestName: 'Ananya Raman', stayStart: '2026-10-02', stayEnd: '2026-10-05', stayLabel: 'Villa 3 plus 1 room', taxRate: '0', advancePaid: '10000',
    lineItems: lines([{ description: 'Chicken Biryani', quantity: 1.5, unitPrice: 380 }, { description: 'Balance rent', quantity: 1, unitPrice: 30000 }]),
  }) });
  assert.equal(created.status, 201);
  const number = created.headers.get('X-Invoice-Number')!;

  const list = await (await call('/api/admin/invoices')).json() as { id: string; invoice_number: string }[];
  const id = list.find(invoice => invoice.invoice_number === number)!.id;
  const record = await (await call(`/api/admin/invoices/${id}`)).json() as Record<string, unknown>;
  assert.equal(record.total_amount, 30_570);
  assert.equal(record.advance_paid, 10_000);
  assert.equal(record.balance_due, 20_570);
  assert.equal(record.stay_start, '2026-10-02');
  assert.equal(record.revision, 0);
  assert.equal('pdf_key' in record, false);

  const edited = await call(`/api/admin/invoices/${id}`, { method: 'PUT', body: invoiceForm({
    guestName: 'Ananya Raman', stayStart: '2026-10-02', stayEnd: '2026-10-05', stayLabel: 'Villa 3 plus 1 room', taxRate: '5', advancePaid: '10000',
    lineItems: lines([{ description: 'Chicken Biryani', quantity: 2, unitPrice: 380 }, { description: 'Balance rent', quantity: 1, unitPrice: 30000 }]),
  }) });
  assert.equal(edited.status, 200);
  assert.equal(edited.headers.get('X-Invoice-Number'), number); // same invoice number after editing
  assert.equal((await PDFDocument.load(new Uint8Array(await edited.arrayBuffer()))).getPageCount(), 1);

  const revised = await (await call(`/api/admin/invoices/${id}`)).json() as Record<string, unknown>;
  assert.equal(revised.revision, 1);
  assert.equal(revised.total_amount, 32_298); // (760 + 30,000) + 5% tax
  assert.equal(revised.balance_due, 22_298);
  assert.equal(revised.created_at, record.created_at);
  const listAfter = await (await call('/api/admin/invoices')).json() as unknown[];
  assert.equal(listAfter.length, 1);
});

test('rejects an advance larger than the bill and quarter portions', async () => {
  const { call } = await signedIn();
  const tooMuch = await call('/api/admin/invoices', { method: 'POST', body: invoiceForm({
    guestName: 'Guest', stayStart: '2026-10-02', stayEnd: '2026-10-03', advancePaid: '5000', lineItems: lines([{ description: 'Tea', quantity: 1, unitPrice: 30 }]),
  }) });
  assert.equal(tooMuch.status, 400);
  assert.match(((await tooMuch.json()) as { error: string }).error, /advance/i);
  const quarter = await call('/api/admin/invoices', { method: 'POST', body: invoiceForm({
    guestName: 'Guest', stayStart: '2026-10-02', stayEnd: '2026-10-03', lineItems: lines([{ description: 'Tea', quantity: 0.25, unitPrice: 30 }]),
  }) });
  assert.equal(quarter.status, 400);
});
