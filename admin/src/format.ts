export const inr = (amount: number) =>
  `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const inrRounded = (amount: number) => `₹${Math.round(amount).toLocaleString('en-IN')}`;

/** Indian short-scale labels for chart axes: ₹1.2K, ₹3.4L, ₹1.1Cr. */
export function inrCompact(amount: number) {
  if (amount >= 1e7) return `₹${trim(amount / 1e7)}Cr`;
  if (amount >= 1e5) return `₹${trim(amount / 1e5)}L`;
  if (amount >= 1e3) return `₹${trim(amount / 1e3)}K`;
  return `₹${Math.round(amount)}`;
}

const trim = (value: number) => value.toFixed(1).replace(/\.0$/, '');

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export function greeting(date = new Date()) {
  const hour = date.getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

export function duration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.max(0, Math.floor((seconds % 3600) / 60));
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export const monthKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}`;

export const meals = ['Breakfast', 'Lunch', 'Evening snacks', 'Dinner'] as const;
export type Meal = typeof meals[number];

/** Current date (yyyy-mm-dd) and hour at the resort, regardless of the device's time zone. */
export function resortNow(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** Breakfast before 11am, lunch until 4pm, evening snacks until 7pm, then dinner. */
export function mealForHour(hour: number): Meal {
  if (hour >= 5 && hour < 11) return 'Breakfast';
  if (hour >= 11 && hour < 16) return 'Lunch';
  if (hour >= 16 && hour < 19) return 'Evening snacks';
  return 'Dinner';
}

/** Bill section label, e.g. "2 Oct · Dinner" (matches the staff notes import). */
export function sectionLabel(isoDate: string, meal: string) {
  const [, month, day] = isoDate.split('-').map(Number);
  // Fixed month names so labels match the notes import on every browser ("Sep", never "Sept").
  const label = `${day} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1]}`;
  return meal ? `${label} · ${meal}` : label;
}

/** Quotes a CSV cell and neutralises spreadsheet formula injection. */
export const csvCell = (value: string | number | null) => {
  const text = value === null ? '' : String(value);
  return `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`;
};

/** Saves rows as a CSV file that opens cleanly in Excel or Google Sheets. */
export function downloadCsv(filename: string, rows: (string | number | null)[][]) {
  const blob = new Blob(['\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const optionLabel = (name: string, option: string) => option ? `${name} · ${option}` : name;
