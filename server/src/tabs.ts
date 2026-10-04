/// <reference types="@cloudflare/workers-types" />
import { z } from 'zod';
import { HttpError } from './env.js';
import { json, jsonBody, noContent, updateJson } from './http.js';
import { loadMenu } from './menu.js';
import { listKeys, putJson, readJson } from './storage.js';

export type TabOrder = {
  id: string;
  item_id: string | null;
  name: string;
  /** Price option label, e.g. "1 kg"; empty for single-price items. */
  option: string;
  quantity: number;
  unit_price: number;
  /** Bill section, e.g. "2 Oct · Dinner". */
  section: string;
  created_at: string;
};

export type Tab = {
  id: string;
  label: string;
  guest_name: string;
  guest_email: string;
  check_in: string;
  status: 'open' | 'closed';
  created_at: string;
  updated_at: string;
  orders: TabOrder[];
  invoice_id?: string;
  invoice_number?: string;
  closed_at?: string;
};

const maxOrders = 400;
const openKey = (id: string) => `tabs/open/${id}.json`;
const closedKey = (id: string) => `tabs/closed/${id}.json`;
const tabId = z.string().uuid();

const total = (tab: Tab) => Math.round(tab.orders.reduce((sum, order) => sum + order.quantity * order.unit_price, 0) * 100) / 100;

function summary(tab: Tab) {
  const { orders, ...rest } = tab;
  return {
    ...rest,
    order_count: orders.reduce((sum, order) => sum + order.quantity, 0),
    total: total(tab),
    last_order_at: orders.at(-1)?.created_at || null,
  };
}

const tabFields = z.object({
  label: z.string().trim().min(1).max(60),
  guestName: z.string().trim().max(140).optional(),
  guestEmail: z.union([z.string().trim().email().max(254), z.literal('')]).optional(),
  checkIn: z.string().date(),
});

const orderInput = z.object({
  itemId: z.string().regex(/^[a-z0-9-]{1,80}$/).nullable().optional(),
  name: z.string().trim().min(1).max(100),
  option: z.string().trim().max(20).default(''),
  quantity: z.number().int().min(1).max(999),
  unitPrice: z.number().min(0).max(10_000_000),
  section: z.string().trim().min(1).max(60),
});

async function findTab(bucket: R2Bucket, id: string) {
  return (await readJson<Tab>(bucket, openKey(id))) || (await readJson<Tab>(bucket, closedKey(id)));
}

/** Marks an open tab as billed by moving it to the closed list. */
export async function closeTab(bucket: R2Bucket, id: string, invoice: { id: string; number: string }) {
  const tab = await readJson<Tab>(bucket, openKey(id));
  if (!tab) return;
  const now = new Date().toISOString();
  await putJson(bucket, closedKey(id), { ...tab, status: 'closed', invoice_id: invoice.id, invoice_number: invoice.number, closed_at: now, updated_at: now });
  await bucket.delete(openKey(id));
}

export async function tabRoutes(request: Request, bucket: R2Bucket, segments: string[]): Promise<Response | null> {
  // segments: ['admin', 'tabs', id?, 'orders'?, orderId?]
  const method = request.method;
  const [, , id, sub, orderId] = segments;

  if (!id && method === 'GET') {
    const [openKeys, closedObjects] = await Promise.all([
      listKeys(bucket, 'tabs/open/'),
      bucket.list({ prefix: 'tabs/closed/', limit: 1000 }),
    ]);
    const open = (await Promise.all(openKeys.map(key => readJson<Tab>(bucket, key)))).filter((tab): tab is Tab => Boolean(tab))
      .sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));
    const recentClosed = closedObjects.objects.sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime()).slice(0, 20);
    const closed = (await Promise.all(recentClosed.map(object => readJson<Tab>(bucket, object.key)))).filter((tab): tab is Tab => Boolean(tab));
    return json({ open: open.map(summary), closed: closed.map(summary) });
  }

  if (!id && method === 'POST') {
    const input = tabFields.safeParse(await jsonBody(request));
    if (!input.success) throw new HttpError(400, 'Enter the room or villa and a check-in date.');
    const existing = (await Promise.all((await listKeys(bucket, 'tabs/open/')).map(key => readJson<Tab>(bucket, key))))
      .find(tab => tab?.label.toLowerCase() === input.data.label.toLowerCase());
    if (existing) throw new HttpError(409, `${existing.label} already has an open tab. Add orders to it, or bill it first.`);
    const now = new Date().toISOString();
    const tab: Tab = {
      id: crypto.randomUUID(),
      label: input.data.label,
      guest_name: input.data.guestName || '',
      guest_email: input.data.guestEmail || '',
      check_in: input.data.checkIn,
      status: 'open',
      created_at: now,
      updated_at: now,
      orders: [],
    };
    await putJson(bucket, openKey(tab.id), tab);
    return json(tab, 201);
  }

  if (!id) return null;
  if (!tabId.safeParse(id).success) throw new HttpError(400, 'Invalid tab.');

  if (!sub && method === 'GET') {
    const tab = await findTab(bucket, id);
    if (!tab) throw new HttpError(404, 'This tab was not found.');
    return json(tab);
  }

  if (!sub && method === 'PATCH') {
    const input = tabFields.partial().safeParse(await jsonBody(request));
    if (!input.success) throw new HttpError(400, 'Check the tab details.');
    const tab = await updateJson<Tab>(bucket, openKey(id), 'This tab is closed or was not found.', current => ({
      ...current,
      label: input.data.label ?? current.label,
      guest_name: input.data.guestName ?? current.guest_name,
      guest_email: input.data.guestEmail ?? current.guest_email,
      check_in: input.data.checkIn ?? current.check_in,
      updated_at: new Date().toISOString(),
    }));
    return json(tab);
  }

  if (!sub && method === 'DELETE') {
    if (!(await readJson<Tab>(bucket, openKey(id)))) throw new HttpError(404, 'This tab is closed or was not found.');
    await bucket.delete(openKey(id));
    return noContent();
  }

  if (sub !== 'orders') return null;

  if (!orderId && method === 'POST') {
    const input = z.object({ orders: z.array(orderInput).min(1).max(60) }).safeParse(await jsonBody(request));
    if (!input.success) throw new HttpError(400, 'Check the items: each needs a name, quantity, price and meal.');
    // Menu prices are authoritative; only "as per availability" items and custom items use the entered price.
    const menu = await loadMenu(bucket);
    const now = new Date().toISOString();
    const additions: TabOrder[] = input.data.orders.map(order => {
      const item = order.itemId ? menu.items.find(candidate => candidate.id === order.itemId) : undefined;
      const option = item?.options.find(candidate => candidate.label === order.option);
      return {
        id: crypto.randomUUID(),
        item_id: item?.id || null,
        name: item?.name || order.name,
        option: option?.label ?? order.option,
        quantity: order.quantity,
        unit_price: option && option.price !== null ? option.price : order.unitPrice,
        section: order.section,
        created_at: now,
      };
    });
    const tab = await updateJson<Tab>(bucket, openKey(id), 'This tab is closed or was not found.', current => {
      if (current.orders.length + additions.length > maxOrders) throw new HttpError(400, 'This tab has too many orders. Bill it and open a new one.');
      return { ...current, orders: [...current.orders, ...additions], updated_at: now };
    });
    return json(tab, 201);
  }

  if (orderId && (method === 'PATCH' || method === 'DELETE')) {
    if (!tabId.safeParse(orderId).success) throw new HttpError(400, 'Invalid order.');
    const quantity = method === 'DELETE' ? 0 : z.object({ quantity: z.number().int().min(0).max(999) }).safeParse(await jsonBody(request)).data?.quantity;
    if (quantity === undefined) throw new HttpError(400, 'Enter a quantity.');
    const tab = await updateJson<Tab>(bucket, openKey(id), 'This tab is closed or was not found.', current => {
      if (!current.orders.some(order => order.id === orderId)) throw new HttpError(404, 'That order was already removed.');
      return {
        ...current,
        orders: quantity === 0
          ? current.orders.filter(order => order.id !== orderId)
          : current.orders.map(order => order.id === orderId ? { ...order, quantity } : order),
        updated_at: new Date().toISOString(),
      };
    });
    return json(tab);
  }

  return null;
}
