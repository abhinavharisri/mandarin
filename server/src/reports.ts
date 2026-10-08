import type { Menu } from './menu.js';

export type InvoiceLineRecord = { description: string; quantity: number; unitPrice: number; section?: string; itemId?: string };

export type InvoiceRecord = {
  id: string;
  invoice_number: string;
  guest_name: string;
  guest_email: string | null;
  total_amount: number;
  currency: 'INR';
  created_at: string;
  pdf_key: string;
  source_bill_key: string | null;
  // Itemised fields; invoices created before reports existed do not have them.
  stay_label?: string | null;
  subtotal?: number;
  tax_amount?: number;
  tax_rate?: number;
  line_items?: InvoiceLineRecord[];
  tab_id?: string | null;
  // Added with editing and advances.
  stay_start?: string;
  stay_end?: string;
  advance_paid?: number;
  balance_due?: number;
  revision?: number;
  updated_at?: string;
};

export type ReportCategory = 'food' | 'room' | 'extras';
export const categoryLabels: Record<ReportCategory | 'tax' | 'unitemised', string> = {
  food: 'Food & beverages',
  room: 'Room & stay',
  extras: 'Activities & extras',
  tax: 'Tax',
  unitemised: 'Not itemised',
};

export type Report = {
  from: string;
  to: string;
  granularity: 'day' | 'month';
  totals: { revenue: number; invoices: number; average: number; tax: number; food: number; room: number; extras: number; unitemised: number; unitemisedInvoices: number };
  trend: { key: string; label: string; total: number; count: number }[];
  byStay: { label: string; total: number; count: number }[];
  topItems: { name: string; quantity: number; revenue: number }[];
  register: { id: string; invoice_number: string; date: string; guest_name: string; stay_label: string; subtotal: number | null; tax: number | null; total: number; advance: number; balance: number }[];
  lines: { invoice_number: string; date: string; stay_label: string; section: string; category: string; description: string; quantity: number; unit_price: number; amount: number }[];
};

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const extrasPattern = /\b(camp\s?fire|bonfire|barbecue|bbq|transfer|taxi|cab|extra\s+bed|laundry|trek|tour|safari|activit(y|ies)|decoration|cake|sightseeing)\b/i;
const roomPattern = /\b(rent|room|villa|cottage|suite|accommodation|tariff|stay|nights?|deposit)\b/i;
const round = (value: number) => Math.round(value * 100) / 100;

/** The invoice's date at the resort (India), as yyyy-mm-dd. */
export function resortDate(iso: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/** Food unless the menu or the wording says it is an activity or a room charge. */
export function classifyLine(line: InvoiceLineRecord, menu: Menu): ReportCategory {
  const item = line.itemId ? menu.items.find(candidate => candidate.id === line.itemId) : undefined;
  if (item) return /extra|activit/i.test(item.category) ? 'extras' : 'food';
  if (extrasPattern.test(line.description)) return 'extras';
  if (roomPattern.test(line.description)) return 'room';
  return 'food';
}

/** "Chicken Gravy × 9" counts as 9 Chicken Gravy for best sellers. */
function itemName(line: InvoiceLineRecord, menu: Menu) {
  const item = line.itemId ? menu.items.find(candidate => candidate.id === line.itemId) : undefined;
  const multiplied = line.description.match(/^(.*?)\s*×\s*(\d+)$/);
  const name = item?.name || (multiplied ? multiplied[1] : line.description.split(' · ')[0]);
  return { name: name.trim(), count: line.quantity * (multiplied ? Number(multiplied[2]) : 1) };
}

export function buildReport(all: InvoiceRecord[], menu: Menu, from: string, to: string): Report {
  const invoices = all
    .map(invoice => ({ invoice, date: resortDate(invoice.created_at) }))
    .filter(({ date }) => date >= from && date <= to)
    .sort((a, b) => a.invoice.created_at.localeCompare(b.invoice.created_at));

  const spanDays = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  const granularity: Report['granularity'] = spanDays <= 45 ? 'day' : 'month';

  // Pre-fill every day or month in the range so gaps show as empty bars.
  const trend = new Map<string, Report['trend'][number]>();
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end && trend.size < 400) {
    const key = granularity === 'day' ? cursor.toISOString().slice(0, 10) : cursor.toISOString().slice(0, 7);
    if (!trend.has(key)) {
      // Days as dd/mm (short enough for the chart axis); months keep their names.
      const label = granularity === 'day' ? `${String(cursor.getUTCDate()).padStart(2, '0')}/${String(cursor.getUTCMonth() + 1).padStart(2, '0')}` : `${months[cursor.getUTCMonth()]} ${cursor.getUTCFullYear()}`;
      trend.set(key, { key, label, total: 0, count: 0 });
    }
    if (granularity === 'day') cursor.setUTCDate(cursor.getUTCDate() + 1);
    else cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1);
  }

  const totals = { revenue: 0, invoices: invoices.length, average: 0, tax: 0, food: 0, room: 0, extras: 0, unitemised: 0, unitemisedInvoices: 0 };
  const byStay = new Map<string, { label: string; total: number; count: number }>();
  const items = new Map<string, { name: string; quantity: number; revenue: number }>();
  const register: Report['register'] = [];
  const lines: Report['lines'] = [];

  for (const { invoice, date } of invoices) {
    const total = Number(invoice.total_amount) || 0;
    totals.revenue += total;
    const bucket = trend.get(granularity === 'day' ? date : date.slice(0, 7));
    if (bucket) {
      bucket.total += total;
      bucket.count += 1;
    }
    const stayLabel = invoice.stay_label?.trim() || 'Not recorded';
    const stay = byStay.get(stayLabel.toLowerCase()) || { label: stayLabel, total: 0, count: 0 };
    stay.total += total;
    stay.count += 1;
    byStay.set(stayLabel.toLowerCase(), stay);

    if (invoice.line_items?.length) {
      totals.tax += invoice.tax_amount || 0;
      for (const line of invoice.line_items) {
        const amount = line.quantity * line.unitPrice;
        const category = classifyLine(line, menu);
        totals[category] += amount;
        if (category === 'food') {
          const { name, count } = itemName(line, menu);
          const entry = items.get(name.toLowerCase()) || { name, quantity: 0, revenue: 0 };
          entry.quantity += count;
          entry.revenue += amount;
          items.set(name.toLowerCase(), entry);
        }
        lines.push({
          invoice_number: invoice.invoice_number, date, stay_label: invoice.stay_label || '', section: line.section || '',
          category: categoryLabels[category], description: line.description, quantity: line.quantity, unit_price: line.unitPrice, amount: round(amount),
        });
      }
    } else {
      totals.unitemised += total;
      totals.unitemisedInvoices += 1;
    }
    register.push({
      id: invoice.id, invoice_number: invoice.invoice_number, date, guest_name: invoice.guest_name, stay_label: invoice.stay_label || '',
      subtotal: invoice.subtotal ?? null, tax: invoice.tax_amount ?? null, total,
      advance: invoice.advance_paid || 0, balance: invoice.balance_due ?? total,
    });
  }

  totals.average = invoices.length ? totals.revenue / invoices.length : 0;
  for (const key of ['revenue', 'average', 'tax', 'food', 'room', 'extras', 'unitemised'] as const) totals[key] = round(totals[key]);

  return {
    from,
    to,
    granularity,
    totals,
    trend: [...trend.values()].map(entry => ({ ...entry, total: round(entry.total) })),
    // Real villas first by revenue; invoices without a villa always last.
    byStay: [...byStay.values()].map(entry => ({ ...entry, total: round(entry.total) }))
      .sort((a, b) => Number(a.label === 'Not recorded') - Number(b.label === 'Not recorded') || b.total - a.total),
    topItems: [...items.values()].map(entry => ({ ...entry, revenue: round(entry.revenue) }))
      .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue).slice(0, 10),
    register: register.reverse(),
    lines,
  };
}
