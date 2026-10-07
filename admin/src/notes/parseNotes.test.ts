import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNotes } from './parseNotes.js';

// Text layer extracted from a real staff notes PDF (Samsung Notes export).
const villaNotes = ['Villa 1', 'Check in 2/10', 'Check out 4/10', '2/10', 'Breakfast', 'Idly 30. -750', "Dosai 20'-1200", 'Coffee4 -200', 'Tea4. -120', 'Dinner', 'Chapati 45 - 1350', 'Panner gravy 8- 2360', 'Chicken gravy-9- 2500', 'Chicken 65 1½kg - 2850', 'Curd rice 5. - 400', 'Chicken biriyani - 380', 'Parotta 2. - 90', 'Panner 65 3 plates - 750', 'Gopi 65 4 plates. - 760', 'Tea 3. - 90', '3/10', 'Curd rice 5. - 400', 'Chicken birayni 9 - 3750', 'Chapathi6. - 180', 'Panner gravy 5. - 1400', 'Gopi 65. 5. - 975', 'Panner biryani 4. - 1120', 'Parotta 2. - 90', 'Tea 2. - 60', 'Coffee1. - 50', 'Total. - 21,825', 'Campfire 2 days- 4000', 'Balance rent. - 35000', 'Total. - 60,825'];

const total = (lines: { quantity: number; unitPrice: number }[]) => Math.round(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) * 100) / 100;

test('reads a villa bill from staff notes and matches the written total', () => {
  const result = parseNotes(villaNotes, new Date('2026-10-04T12:00:00Z'));
  assert.equal(result.stayLabel, 'Villa 1');
  assert.equal(result.stayStart, '2026-10-02');
  assert.equal(result.stayEnd, '2026-10-04');
  assert.equal(result.lines.length, 25);
  assert.deepEqual(result.skipped, []);
  assert.equal(result.declaredTotal, 60825);
  assert.equal(total(result.lines), 60825);
});

test('splits names, quantities and sections like a person would', () => {
  const lines = parseNotes(villaNotes, new Date('2026-10-04T12:00:00Z')).lines;
  const find = (source: string) => lines.find(line => line.source === source)!;
  assert.deepEqual(
    (({ section, description, quantity, unitPrice }) => ({ section, description, quantity, unitPrice }))(find('Idly 30. -750')),
    { section: '2 Oct · Breakfast', description: 'Idli', quantity: 30, unitPrice: 25 },
  );
  assert.equal(find("Dosai 20'-1200").description, 'Dosa');
  assert.deepEqual([find('Coffee4 -200').quantity, find('Coffee4 -200').unitPrice], [4, 50]);
  // 2500 / 9 is not a whole price, so the line keeps its exact amount.
  assert.deepEqual([find('Chicken gravy-9- 2500').description, find('Chicken gravy-9- 2500').quantity, find('Chicken gravy-9- 2500').unitPrice], ['Chicken Gravy × 9', 1, 2500]);
  assert.deepEqual([find('Chicken 65 1½kg - 2850').description, find('Chicken 65 1½kg - 2850').unitPrice], ['Chicken 65 (1½ kg)', 2850]);
  assert.deepEqual([find('Panner 65 3 plates - 750').description, find('Panner 65 3 plates - 750').quantity], ['Paneer 65', 3]);
  assert.deepEqual([find('Gopi 65. 5. - 975').description, find('Gopi 65. 5. - 975').quantity], ['Gobi 65', 5]);
  assert.deepEqual([find('Chicken biriyani - 380').description, find('Chicken biriyani - 380').quantity], ['Chicken Biryani', 1]);
  assert.equal(find('Chapathi6. - 180').section, '3 Oct');
  assert.deepEqual([find('Campfire 2 days- 4000').description, find('Campfire 2 days- 4000').section, find('Campfire 2 days- 4000').unitPrice], ['Campfire (per day)', 'Stay & extras', 2000]);
  assert.equal(find('Balance rent. - 35000').description, 'Balance Rent');
});

test('handles other common note styles and reports unreadable lines', () => {
  const result = parseNotes(['Room 4', 'Check-in: 30/12/2026', 'Check-out: 2/1', '30.12', 'Lunch:', 'Meals 4 - 1,200/-', 'Water bottle 2 Rs 60', 'Fish 65 - 450', 'see manager', 'Grand total 1710'], new Date('2026-12-30T00:00:00Z'));
  assert.equal(result.stayLabel, 'Room 4');
  assert.equal(result.stayEnd, '2027-01-02');
  assert.deepEqual(result.lines.map(line => [line.section, line.description, line.quantity, line.unitPrice]), [
    ['30 Dec · Lunch', 'Meals', 4, 300],
    ['30 Dec · Lunch', 'Water Bottle', 2, 30],
    ['30 Dec · Lunch', 'Fish 65', 1, 450],
  ]);
  assert.deepEqual(result.skipped, ['see manager']);
  assert.equal(result.declaredTotal, 1710);
});

test('reads month-first dates when that is what the note means', () => {
  const result = parseNotes(['Villa 3 plus 1 room', 'Check in 10/2', 'Check out 10/5', '10/2', 'Breakfast', 'Dosai 4 - 240'], new Date('2026-10-06T12:00:00Z'));
  assert.equal(result.stayStart, '2026-10-02');
  assert.equal(result.stayEnd, '2026-10-05');
  assert.equal(result.lines[0].section, '2 Oct · Breakfast');
  // A date that can only be day-first settles the order for the whole note.
  const dayFirst = parseNotes(['Check in 10/2', 'Check out 25/2', 'Tea 1 - 30'], new Date('2026-10-06T12:00:00Z'));
  assert.equal(dayFirst.stayStart, '2026-02-10');
});

test('keeps half portions as quantities', () => {
  const lines = parseNotes(['Chicken biriyani ½ - 190', 'Parotta 1½ - 67.50', 'Mutton curry 2.5 - 900', 'Chicken 65 1½kg - 2850'], new Date('2026-10-06T12:00:00Z')).lines;
  assert.deepEqual(lines.map(line => [line.description, line.quantity, line.unitPrice]), [
    ['Chicken Biryani', 0.5, 380],
    ['Parotta', 1.5, 45],
    ['Mutton Curry', 2.5, 360],
    ['Chicken 65 (1½ kg)', 1, 2850],
  ]);
});
