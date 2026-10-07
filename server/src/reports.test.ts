import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { defaultMenu } from './menu.js';
import { buildReportPdf } from './reportPdf.js';
import { buildReport, classifyLine, InvoiceRecord } from './reports.js';

const invoice = (id: string, created_at: string, total: number, extra: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
  id, invoice_number: `MO-2026-${id}`, guest_name: `Guest ${id}`, guest_email: null, total_amount: total, currency: 'INR',
  created_at, pdf_key: '', source_bill_key: null, ...extra,
});

const villa1 = invoice('A', '2026-10-04T06:00:00Z', 60_825, {
  stay_label: 'Villa 1', subtotal: 60_825, tax_amount: 0, tax_rate: 0,
  line_items: [
    { description: 'Idli', quantity: 30, unitPrice: 25, section: '2 Oct · Breakfast' },
    { description: 'Chicken Gravy × 9', quantity: 1, unitPrice: 2500, section: '2 Oct · Dinner' },
    { description: 'Chilli Chicken (BL) · 1 kg', quantity: 1, unitPrice: 1900, itemId: 'starters-non-veg-chilli-chicken-bl' },
    { description: 'Campfire (per day)', quantity: 2, unitPrice: 2000, section: 'Stay & extras' },
    { description: 'Balance Rent', quantity: 1, unitPrice: 35000, section: 'Stay & extras' },
    { description: 'Idli', quantity: 10, unitPrice: 25 },
    { description: 'Misc food', quantity: 1, unitPrice: 16_425 }, // lines add up to the 60,825 total
  ],
});
const villa2 = invoice('B', '2026-10-05T23:30:00Z', 11_800, { // 6 Oct 05:00 in India
  stay_label: 'villa 1 ', subtotal: 10_000, tax_amount: 1800, tax_rate: 18,
  line_items: [{ description: 'Villa night', quantity: 2, unitPrice: 5000 }],
});
const legacy = invoice('C', '2026-09-20T10:00:00Z', 5000);
const outside = invoice('D', '2026-11-02T10:00:00Z', 999);

test('classifies lines as food, room or extras', () => {
  const kind = (description: string, itemId?: string) => classifyLine({ description, quantity: 1, unitPrice: 1, itemId }, defaultMenu);
  assert.equal(kind('Balance Rent'), 'room');
  assert.equal(kind('Villa night'), 'room');
  assert.equal(kind('Campfire (per day)'), 'extras');
  assert.equal(kind('Airport transfer'), 'extras');
  assert.equal(kind('Mushroom Masala'), 'food'); // "room" inside "Mushroom" is not a room charge
  assert.equal(kind('Non-Veg Dinner'), 'food');
  assert.equal(kind('Camp Fire (2½ hours)', 'extras-camp-fire-2-half-hours'), 'extras');
});

test('builds totals, splits, villas and best sellers for a date range', () => {
  const report = buildReport([outside, legacy, villa2, villa1], defaultMenu, '2026-09-01', '2026-10-31');
  assert.equal(report.granularity, 'month');
  assert.equal(report.totals.invoices, 3);
  assert.equal(report.totals.revenue, 60_825 + 11_800 + 5000);
  assert.equal(report.totals.room, 35_000 + 10_000);
  assert.equal(report.totals.extras, 4000);
  assert.equal(report.totals.food, 750 + 2500 + 1900 + 250 + 16_425);
  assert.equal(report.totals.tax, 1800);
  assert.equal(report.totals.unitemised, 5000);
  assert.equal(report.totals.unitemisedInvoices, 1);
  assert.equal(report.totals.food + report.totals.room + report.totals.extras + report.totals.tax + report.totals.unitemised, report.totals.revenue);

  assert.deepEqual(report.trend.map(entry => [entry.key, entry.total, entry.count]), [['2026-09', 5000, 1], ['2026-10', 72_625, 2]]);
  assert.deepEqual(report.byStay.map(stay => [stay.label, stay.total, stay.count]), [['Villa 1', 72_625, 2], ['Not recorded', 5000, 1]]);
  // "Not recorded" stays last even when it is the largest.
  const legacyHeavy = buildReport([villa2, invoice('E', '2026-10-06T08:00:00Z', 500_000)], defaultMenu, '2026-10-01', '2026-10-31');
  assert.deepEqual(legacyHeavy.byStay.map(stay => stay.label), ['villa 1', 'Not recorded']);
  // Ranked by quantity, ties broken by revenue; menu items use their menu name.
  assert.deepEqual(report.topItems.map(item => [item.name, item.quantity]), [['Idli', 40], ['Chicken Gravy', 9], ['Misc food', 1], ['Chilli Chicken (BL)', 1]]);
  assert.equal(report.register[0].invoice_number, 'MO-2026-B'); // newest first
  assert.equal(report.lines.length, 8);
});

test('uses India dates and daily buckets for short ranges', () => {
  const report = buildReport([villa1, villa2], defaultMenu, '2026-10-01', '2026-10-06');
  assert.equal(report.granularity, 'day');
  assert.equal(report.trend.length, 6);
  assert.equal(report.trend.find(entry => entry.key === '2026-10-06')!.total, 11_800);
  assert.equal(report.trend.find(entry => entry.key === '2026-10-05')!.total, 0);
  assert.equal(buildReport([villa2], defaultMenu, '2026-10-05', '2026-10-05').totals.invoices, 0);
});

test('renders a multi-page PDF report', async () => {
  const many = Array.from({ length: 70 }, (_, index) => invoice(String(index), `2026-10-0${(index % 5) + 1}T08:00:00Z`, 1000 + index, {
    stay_label: `Villa ${(index % 4) + 1}`, subtotal: 1000 + index, tax_amount: 0, line_items: [{ description: 'Tea', quantity: 1, unitPrice: 1000 + index }],
  }));
  const pdf = await buildReportPdf(buildReport([...many, legacy], defaultMenu, '2026-09-01', '2026-10-31'));
  assert.ok((await PDFDocument.load(pdf)).getPageCount() > 1);
});
