import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInvoicePdf, calculateTotals } from './invoice.js';

test('calculates INR invoice totals with tax rounded to paise', () => {
  assert.deepEqual(calculateTotals([
    { description: 'Room stay', quantity: 2, unitPrice: 1250.5 },
    { description: 'Dinner', quantity: 1, unitPrice: 500 },
  ], 5), {
    subtotal: 3001,
    taxAmount: 150.05,
    total: 3151.05,
  });
});

test('creates a valid one-page PDF invoice', async () => {
  const pdf = await buildInvoicePdf({
    invoiceNumber: 'MO-2026-0001',
    issueDate: new Date('2026-10-04T00:00:00Z'),
    guestName: 'Guest Example',
    stayStart: new Date('2026-10-10T00:00:00Z'),
    stayEnd: new Date('2026-10-12T00:00:00Z'),
    taxRate: 0,
    lineItems: [{ description: 'Two nights stay', quantity: 2, unitPrice: 5000 }],
  });

  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.includes(Buffer.from('/Type /Page')));
  assert.ok(pdf.includes(Buffer.from('%%EOF')));
});
