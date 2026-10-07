import { useMemo, useState } from 'react';
import { inr, inrCompact, monthKey } from './format';
import { categories, GalleryImage, InvoiceSummary } from './types';

export type TrendBucket = { key: string; label: string; fullLabel: string; total: number; count: number };
type MonthBucket = TrendBucket;

export function monthlyRevenue(invoices: InvoiceSummary[], months: number, now = new Date()): MonthBucket[] {
  const buckets: MonthBucket[] = [];
  for (let offset = months - 1; offset >= 0; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    buckets.push({
      key: monthKey(date),
      label: date.toLocaleDateString('en-IN', { month: 'short' }),
      fullLabel: date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
      total: 0,
      count: 0,
    });
  }
  const byKey = new Map(buckets.map(bucket => [bucket.key, bucket]));
  for (const invoice of invoices) {
    const bucket = byKey.get(monthKey(new Date(invoice.created_at)));
    if (!bucket) continue;
    bucket.total += Number(invoice.total_amount);
    bucket.count += 1;
  }
  return buckets;
}

/** Rounds up to a readable axis maximum (1, 2, 2.5, 5 × 10ⁿ). */
function niceMax(value: number) {
  if (value <= 0) return 1000;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find(multiple => multiple * magnitude >= value) || 10;
  return step * magnitude;
}

export function RevenueChart({ invoices, months }: { invoices: InvoiceSummary[]; months: number }) {
  const buckets = useMemo(() => monthlyRevenue(invoices, months), [invoices, months]);
  return <TrendChart buckets={buckets} label={`Invoiced revenue for the last ${months} months`} />;
}

/** Single-series revenue bars with hover / focus tooltips. Long ranges label every nth bar. */
export function TrendChart({ buckets, label }: { buckets: TrendBucket[]; label: string }) {
  const [active, setActive] = useState<number | null>(null);
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 12));
  const max = niceMax(Math.max(...buckets.map(bucket => bucket.total)));
  const ticks = [max, max / 2, 0];
  const empty = buckets.every(bucket => bucket.total === 0);

  return (
    <figure className="bar-chart" aria-label={label}>
      <div className="bar-chart-plot">
        <div className="bar-chart-grid" aria-hidden="true">
          {ticks.map(tick => <div key={tick} className="grid-line"><span>{inrCompact(tick)}</span></div>)}
        </div>
        <div className="bar-chart-bars" style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }} key={buckets.map(bucket => bucket.key).join()}>
          {buckets.map((bucket, index) => (
            <div key={bucket.key} className={active === index ? 'bar-column active' : 'bar-column'}
              tabIndex={0} role="img"
              aria-label={`${bucket.fullLabel}: ${inr(bucket.total)} from ${bucket.count} invoice${bucket.count === 1 ? '' : 's'}`}
              onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(index)} onBlur={() => setActive(null)}>
              <div className="bar" style={{ height: `${(bucket.total / max) * 100}%`, animationDelay: `${Math.min(index, 30) * 30}ms` }} />
              {active === index && (
                <div className={index === buckets.length - 1 ? 'chart-tooltip left' : index === 0 ? 'chart-tooltip right' : 'chart-tooltip'}
                  style={{ bottom: `calc(${Math.min(62, (bucket.total / max) * 100)}% + 10px)` }} aria-hidden="true">
                  <span>{bucket.fullLabel}</span>
                  <strong>{inr(bucket.total)}</strong>
                  <small>{bucket.count} invoice{bucket.count === 1 ? '' : 's'}</small>
                </div>
              )}
            </div>
          ))}
        </div>
        {empty && <p className="chart-empty">No invoices in this period.</p>}
      </div>
      <div className="bar-chart-labels" style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }} aria-hidden="true">
        {buckets.map((bucket, index) => (
          <span key={bucket.key} className={active === index ? 'active' : ''}>{index % labelEvery === 0 || active === index ? bucket.label : ''}</span>
        ))}
      </div>
    </figure>
  );
}

export function CategoryBars({ images }: { images: GalleryImage[] }) {
  const counts = categories.map(category => ({
    ...category,
    count: images.filter(image => image.category === category.id).length,
  }));
  const max = Math.max(1, ...counts.map(category => category.count));
  return (
    <ul className="category-bars">
      {counts.map((category, index) => (
        <li key={category.id} title={`${category.label}: ${category.count} photos`}>
          <div className="category-bars-label"><span>{category.label}</span><strong>{category.count}</strong></div>
          <div className="category-bars-track" role="img" aria-label={`${category.label}: ${category.count} of ${images.length} photos`}>
            <div className="category-bars-fill" style={{ width: `${(category.count / max) * 100}%`, animationDelay: `${150 + index * 80}ms` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
