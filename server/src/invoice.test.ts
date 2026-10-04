import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { buildInvoicePdf, calculateTotals, pdfSafe } from './invoice.js';

const pageCount = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount();

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

  const text = Buffer.from(pdf).toString('latin1');
  assert.ok(text.startsWith('%PDF-'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.equal(await pageCount(pdf), 1);
});

test('handles non-Latin names and long bills without failing', async () => {
  const pdf = await buildInvoicePdf({
    invoiceNumber: 'MO-2026-0002',
    issueDate: new Date(),
    guestName: 'அனன்யா “Ananya” Raman — José',
    stayStart: new Date(),
    stayEnd: new Date(),
    taxRate: 18,
    lineItems: Array.from({ length: 30 }, (_, index) => ({ description: `Villa night ${index + 1} with breakfast and evening bonfire on the lawn`, quantity: 1, unitPrice: 9500 })),
  });
  assert.ok(await pageCount(pdf) > 1);
});

test('maps characters the PDF fonts cannot draw', () => {
  assert.equal(pdfSafe('“José” – ₹500'), '"José" - Rs.500');
  assert.equal(pdfSafe('அ'), '?');
});
