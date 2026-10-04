import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpError } from './env.js';
import { fakeBucket } from './fakeBucket.js';
import { defaultMenu, menuRoutes } from './menu.js';
import { closeTab, Tab, tabRoutes } from './tabs.js';

const call = async (bucket: R2Bucket, method: string, path: string, body?: unknown) => {
  const request = new Request(`http://localhost${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const segments = path.split('/').filter(Boolean).slice(1);
  let response: Response | null;
  try {
    response = segments[1] === 'menu' ? await menuRoutes(request, bucket, path) : await tabRoutes(request, bucket, segments);
  } catch (error) {
    if (error instanceof HttpError) return { status: error.status, body: { error: error.message } as any };
    throw error;
  }
  assert.ok(response, `no route for ${method} ${path}`);
  return { status: response.status, body: response.status === 204 ? null : await response.json() as any };
};

test('seeds the full printed menu with unique ids and plate / kg options', () => {
  assert.equal(defaultMenu.items.length, 83); // every line on the printed card, plus the camp fire
  assert.equal(new Set(defaultMenu.items.map(item => item.id)).size, defaultMenu.items.length);
  const chilli = defaultMenu.items.find(item => item.name === 'Chilli Chicken (BL)')!;
  assert.deepEqual(chilli.options, [{ label: 'Plate', price: 380 }, { label: '1 kg', price: 1900 }]);
  assert.equal(defaultMenu.items.find(item => item.name === 'Sea Food')!.options[0].price, null);
  assert.equal(defaultMenu.items.find(item => item.name === 'Paneer Butter Masala')!.options[0].price, 295);
});

test('saves an edited menu and rejects invalid ones', async () => {
  const { bucket } = fakeBucket();
  const items = defaultMenu.items.map(item => item.name === 'Tea' ? { ...item, options: [{ label: '', price: 35 }] } : item);
  assert.equal((await call(bucket, 'PUT', '/api/admin/menu', { items })).status, 200);
  const saved = (await call(bucket, 'GET', '/api/admin/menu')).body;
  assert.equal(saved.items.find((item: any) => item.name === 'Tea').options[0].price, 35);
  assert.ok(saved.updated_at);
  assert.equal((await call(bucket, 'PUT', '/api/admin/menu', { items: [{ ...items[0], name: '' }] })).status, 400);
});

test('runs a tab from opening to billing, using menu prices', async () => {
  const { bucket } = fakeBucket();
  const tab = (await call(bucket, 'POST', '/api/admin/tabs', { label: 'Villa 1', checkIn: '2026-10-02' })).body as Tab;
  assert.equal((await call(bucket, 'POST', '/api/admin/tabs', { label: 'villa 1', checkIn: '2026-10-02' })).status, 409);

  const added = (await call(bucket, 'POST', `/api/admin/tabs/${tab.id}/orders`, { orders: [
    { itemId: 'tiffin-idly-2-nos', name: 'Idly (2 Nos)', quantity: 15, unitPrice: 1, section: '2 Oct · Breakfast' },
    { itemId: 'starters-non-veg-chilli-chicken-bl', name: 'Chilli Chicken (BL)', option: '1 kg', quantity: 1, unitPrice: 0, section: '2 Oct · Dinner' },
    { itemId: 'seafood-sea-food', name: 'Sea Food', quantity: 1, unitPrice: 1200, section: '2 Oct · Dinner' },
    { name: 'Balance rent', quantity: 1, unitPrice: 35000, section: 'Stay & extras' },
  ] })).body as Tab;
  assert.deepEqual(added.orders.map(order => [order.name, order.option, order.quantity, order.unit_price]), [
    ['Idly (2 Nos)', '', 15, 50], // menu price wins over the submitted price
    ['Chilli Chicken (BL)', '1 kg', 1, 1900],
    ['Sea Food', '', 1, 1200], // "as per availability" uses the entered price
    ['Balance rent', '', 1, 35000],
  ]);

  const idly = added.orders[0];
  assert.equal((await call(bucket, 'PATCH', `/api/admin/tabs/${tab.id}/orders/${idly.id}`, { quantity: 10 })).body.orders[0].quantity, 10);
  assert.equal((await call(bucket, 'DELETE', `/api/admin/tabs/${tab.id}/orders/${added.orders[3].id}`)).body.orders.length, 3);

  const list = (await call(bucket, 'GET', '/api/admin/tabs')).body;
  assert.equal(list.open[0].total, 500 + 1900 + 1200);
  assert.equal(list.open[0].order_count, 12);

  await closeTab(bucket, tab.id, { id: 'invoice-id', number: 'MO-2026-TEST' });
  const after = (await call(bucket, 'GET', '/api/admin/tabs')).body;
  assert.equal(after.open.length, 0);
  assert.equal(after.closed[0].invoice_number, 'MO-2026-TEST');
  assert.equal((await call(bucket, 'POST', `/api/admin/tabs/${tab.id}/orders`, { orders: [{ name: 'Tea', quantity: 1, unitPrice: 30, section: 'x' }] })).status, 404);
});

test('keeps every order when two staff add at the same moment', async () => {
  const { bucket } = fakeBucket();
  const tab = (await call(bucket, 'POST', '/api/admin/tabs', { label: 'Villa 2', checkIn: '2026-10-02' })).body as Tab;
  const add = (name: string) => call(bucket, 'POST', `/api/admin/tabs/${tab.id}/orders`, { orders: [{ name, quantity: 1, unitPrice: 30, section: '2 Oct · Lunch' }] });
  await Promise.all(['Tea', 'Coffee', 'Milk', 'Juice'].map(add));
  const final = (await call(bucket, 'GET', `/api/admin/tabs/${tab.id}`)).body as Tab;
  assert.deepEqual(final.orders.map(order => order.name).sort(), ['Coffee', 'Juice', 'Milk', 'Tea']);
});
