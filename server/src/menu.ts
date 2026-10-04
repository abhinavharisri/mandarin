/// <reference types="@cloudflare/workers-types" />
import { z } from 'zod';
import { HttpError } from './env.js';
import { json, jsonBody } from './http.js';
import { putJson, readJson } from './storage.js';

export type Diet = 'veg' | 'nonveg' | 'egg';
/** A price option; `price: null` means "as per availability" and is entered when ordering. */
export type MenuOption = { label: string; price: number | null };
export type MenuItem = { id: string; name: string; category: string; diet: Diet; options: MenuOption[]; available: boolean };
export type Menu = { items: MenuItem[]; updated_at: string | null };

const menuKey = 'menu/menu.json';

type Seed = [name: string, diet: Diet, ...prices: (number | null | [string, number])[]];

// Transcribed from the printed Mandarin Orchid food & beverages menu.
const seedMenu: Record<string, Seed[]> = {
  Soups: [
    ['Hot & Sour Chicken Soup', 'nonveg', 139], ['Sweet Corn Chicken Soup', 'nonveg', 139], ['Naattu Kozhi Rasam', 'nonveg', 150],
    ['Chicken Clear Soup', 'nonveg', 125], ['Veg Clear Soup', 'veg', 105], ['Green Mushroom Soup', 'veg', 139], ['Sweet Corn Veg Soup', 'veg', 123],
  ],
  'Non-Veg Gravy': [['Naattu Kozhi (1 kg)', 'nonveg', 2500], ['Chicken Curry (1 kg)', 'nonveg', 1500], ['Mutton Curry (1 kg)', 'nonveg', 2000]],
  'Veg Gravy': [
    ['Mushroom Masala', 'veg', 257], ['Paneer Masala', 'veg', 280], ['Paneer Butter Masala', 'veg', 295], ['Green Peas Masala', 'veg', 225],
    ['Aloo Gobi Masala', 'veg', 260], ['Veg Mixed Curry', 'veg', 260], ['Dal Fry', 'veg', 210],
  ],
  Egg: [
    ['Omelette', 'egg', 50], ['Double Omelette', 'egg', 100], ['Egg Bhurji (2 eggs)', 'egg', 120], ['Egg Masala (2 eggs)', 'egg', 200],
    ['Egg Noodles', 'egg', 220], ['Boiled Egg', 'egg', 30],
  ],
  'Starters (Non-Veg)': [
    ['Mutton Balls (3 pcs)', 'nonveg', 225],
    ['Chilli Chicken (BL)', 'nonveg', ['Plate', 380], ['1 kg', 1900]],
    ['Garlic / Pepper Chicken', 'nonveg', ['Plate', 340], ['1 kg', 1700]],
  ],
  'Starters (Veg)': [['Mushroom Chilli / Fry', 'veg', 200], ['Paneer Chilli / Fry', 'veg', 250], ['French Fries', 'veg', 120], ['Chilli Gobi', 'veg', 190]],
  'Dry (Non-Veg)': [
    ['Naattu Kozhi Fry (1 kg)', 'nonveg', 2700], ['Pallipalayam Dry (1 kg)', 'nonveg', 1850],
    ['Chintamani Chicken Dry (1 kg)', 'nonveg', 1850], ['Mutton Dry Items (per plate)', 'nonveg', 480],
  ],
  Seafood: [['Sea Food', 'nonveg', null]],
  Biryani: [
    ['Mutton Biryani (1 kg)', 'nonveg', 3000], ['Chicken Biryani (1 kg)', 'nonveg', 2500], ['Plain Biryani', 'veg', 240],
    ['Mushroom Biryani', 'veg', 250], ['Veg Biryani', 'veg', 250],
  ],
  Tiffin: [
    ['Idly (2 Nos)', 'veg', 50], ['Kal Dosai', 'veg', 80], ['Dosai', 'veg', 60], ['Plain Roast', 'veg', 90], ['Onion Roast', 'veg', 130],
    ['Ghee Roast', 'veg', 130], ['Masala Roast (1 pc)', 'veg', 150], ['Poori', 'veg', 50], ['Kitchadi', 'veg', 200], ['Pongal', 'veg', 200],
    ['Egg Dosai', 'egg', 150],
  ],
  Meals: [
    ['Veg Meals', 'veg', 350], ['Non-Veg Meals', 'nonveg', 450], ['Veg Dinner', 'veg', 450], ['Non-Veg Dinner', 'nonveg', 550],
    ['Plain Rice', 'veg', 60], ['Curd', 'veg', 50], ['Sambar Rice', 'veg', 120],
  ],
  'Fried Rice': [
    ['Egg Fried Rice', 'egg', 250], ['Chicken Fried Rice', 'nonveg', 280], ['Veg Fried Rice', 'veg', 240],
    ['Mushroom Fried Rice', 'veg', 250], ['Paneer Fried Rice', 'veg', 260],
  ],
  'Indian Breads': [
    ['Chapati (per piece)', 'veg', 30], ['Parotta (per piece)', 'veg', 45], ['Naan', 'veg', 80], ['Butter Naan', 'veg', 85],
    ['Roti', 'veg', 70], ['Butter Roti', 'veg', 75], ['Bread Omelette', 'egg', 150], ['Bread & Jam', 'veg', 120],
  ],
  Snacks: [
    ['Onion Pakoda', 'veg', 150], ['Peanut Masala', 'veg', 150], ['Bajji (per piece)', 'veg', 30], ['Potato Bonda', 'veg', 40],
    ['Tea', 'veg', 30], ['Coffee', 'veg', 50], ['Milk', 'veg', 50],
  ],
  Salad: [['Veg Salad', 'veg', 200], ['Fruit Salad', 'veg', 220], ['Mixed Salad', 'veg', 240]],
  Juices: [['Juices', 'veg', null]],
  Extras: [['Camp Fire (2½ hours)', 'veg', 2500]],
};

const slug = (text: string) => text.toLowerCase().replace(/½/g, '-half').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const defaultMenu: Menu = {
  updated_at: null,
  items: Object.entries(seedMenu).flatMap(([category, items]) => items.map(([name, diet, ...prices]) => ({
    id: slug(`${category}-${name}`),
    name,
    category,
    diet,
    available: true,
    options: prices.map(price => Array.isArray(price) ? { label: price[0], price: price[1] } : { label: '', price }),
  }))),
};

const menuSchema = z.object({
  items: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]{1,80}$/),
    name: z.string().trim().min(1).max(80),
    category: z.string().trim().min(1).max(40),
    diet: z.enum(['veg', 'nonveg', 'egg']),
    available: z.boolean(),
    options: z.array(z.object({
      label: z.string().trim().max(20),
      price: z.number().min(0).max(10_000_000).nullable(),
    })).min(1).max(4),
  })).max(500),
});

export const loadMenu = async (bucket: R2Bucket) => (await readJson<Menu>(bucket, menuKey)) || defaultMenu;

export async function menuRoutes(request: Request, bucket: R2Bucket, path: string) {
  if (path === '/api/admin/menu' && request.method === 'GET') return json(await loadMenu(bucket));
  if (path === '/api/admin/menu' && request.method === 'PUT') {
    const input = menuSchema.safeParse(await jsonBody(request));
    if (!input.success) throw new HttpError(400, 'Check the menu: every item needs a name, a category and valid prices.');
    if (new Set(input.data.items.map(item => item.id)).size !== input.data.items.length) throw new HttpError(400, 'Two menu items share the same id.');
    const menu: Menu = { items: input.data.items, updated_at: new Date().toISOString() };
    await putJson(bucket, menuKey, menu);
    return json(menu);
  }
  return null;
}
