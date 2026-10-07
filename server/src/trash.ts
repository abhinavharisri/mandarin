/// <reference types="@cloudflare/workers-types" />
import { HttpError } from './env.js';
import { json, noContent } from './http.js';
import type { InvoiceRecord } from './reports.js';
import { listKeys, putJson, readJson, requireJson } from './storage.js';

/** Deleted invoices stay restorable for this long before being removed for good. */
export const retentionDays = 30;
const retentionMs = retentionDays * 86_400_000;

export type TrashedInvoice = InvoiceRecord & { deleted_at: string };

const liveKey = (id: string) => `invoices/${id}.json`;
const trashKey = (id: string) => `trash/invoices/${id}.json`;
const expiresAt = (record: TrashedInvoice) => new Date(new Date(record.deleted_at).getTime() + retentionMs).toISOString();

/**
 * Moves an invoice into Recently deleted. Its PDF and attached bill stay where they are;
 * only the record moves, which hides it from the history, downloads and reports.
 */
export async function moveToTrash(bucket: R2Bucket, id: string, now = new Date()) {
  const record = await requireJson<InvoiceRecord>(bucket, liveKey(id), 'Invoice was not found.');
  // Write the bin copy first so a failure part-way can never lose the invoice.
  await putJson(bucket, trashKey(id), { ...record, deleted_at: now.toISOString() } satisfies TrashedInvoice);
  await bucket.delete(liveKey(id));
  return record;
}

async function purge(bucket: R2Bucket, record: TrashedInvoice) {
  await bucket.delete([trashKey(record.id), record.pdf_key, ...(record.source_bill_key ? [record.source_bill_key] : [])]);
}

async function trashedInvoices(bucket: R2Bucket) {
  const records = await Promise.all((await listKeys(bucket, 'trash/invoices/')).map(key => readJson<TrashedInvoice>(bucket, key)));
  return records.filter((record): record is TrashedInvoice => Boolean(record));
}

/** Permanently removes invoices that have been in the bin longer than the retention period. */
export async function purgeExpired(bucket: R2Bucket, now = new Date()) {
  const records = await trashedInvoices(bucket);
  const expired = records.filter(record => new Date(expiresAt(record)) <= now);
  await Promise.all(expired.map(record => purge(bucket, record)));
  return records.filter(record => !expired.includes(record));
}

/**
 * Routes under /api/admin/trash. `confirmPassword` re-checks the admin password and throws
 * when it is wrong; permanent deletion always requires it.
 */
export async function trashRoutes(request: Request, bucket: R2Bucket, segments: string[], confirmPassword: (failure: string) => Promise<void>) {
  const [, , id, action] = segments;
  const method = request.method;

  if (!id && method === 'GET') {
    const records = await purgeExpired(bucket);
    return json({
      retention_days: retentionDays,
      items: records
        .sort((a, b) => b.deleted_at.localeCompare(a.deleted_at))
        .map(({ pdf_key: _pdf, source_bill_key: _source, line_items: _lines, ...record }) => ({ ...record, expires_at: expiresAt(record as TrashedInvoice) })),
    });
  }

  if (!id && method === 'DELETE') {
    await confirmPassword('The password is incorrect. Nothing was deleted.');
    const records = await trashedInvoices(bucket);
    await Promise.all(records.map(record => purge(bucket, record)));
    return json({ deleted: records.length });
  }

  if (!id || !/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(400, 'Invalid invoice.');
  const record = await readJson<TrashedInvoice>(bucket, trashKey(id));
  if (!record) throw new HttpError(404, 'This invoice is no longer in Recently deleted.');

  if (action === 'restore' && method === 'POST') {
    if (await readJson(bucket, liveKey(id))) throw new HttpError(409, 'This invoice is already in the invoice history.');
    const { deleted_at: _deleted, ...restored } = record;
    await putJson(bucket, liveKey(id), restored);
    await bucket.delete(trashKey(id));
    return json({ id, invoice_number: record.invoice_number });
  }

  if (action === 'download' && method === 'GET') {
    const pdf = await bucket.get(record.pdf_key);
    if (!pdf) throw new HttpError(404, 'The invoice PDF could not be found.');
    return new Response(pdf.body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${record.invoice_number}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }

  if (!action && method === 'DELETE') {
    await confirmPassword('The password is incorrect. The invoice was not deleted.');
    await purge(bucket, record);
    return noContent();
  }

  return null;
}
