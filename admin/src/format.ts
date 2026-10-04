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
