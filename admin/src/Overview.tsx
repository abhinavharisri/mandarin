import { ReactNode, useEffect, useMemo, useState } from 'react';
import { CategoryBars, monthlyRevenue, RevenueChart } from './charts';
import { formatDate, greeting, inrRounded, shortDate } from './format';
import { api } from './client';
import { InvoiceTable } from './InvoiceTable';
import { GalleryImage, InvoiceSummary, TabSummary, View } from './types';
import { CountUp, Icon, Segmented, stagger } from './ui';

const websitePages = [
  { label: 'Home page', href: '/' },
  { label: 'Photo gallery', href: '/gallery' },
  { label: 'Rooms', href: '/rooms' },
  { label: 'Contact', href: '/contactus' },
];

export function Overview({ gallery, invoices, loading, onNavigate }: {
  gallery: GalleryImage[]; invoices: InvoiceSummary[]; loading: boolean; onNavigate: (view: View) => void;
}) {
  const [months, setMonths] = useState<'6' | '12'>('6');
  const [openTabs, setOpenTabs] = useState<TabSummary[] | null>(null);
  useEffect(() => {
    api<{ open: TabSummary[] }>('/api/admin/tabs').then(list => setOpenTabs(list.open)).catch(() => setOpenTabs([]));
  }, []);
  const tabsTotal = (openTabs || []).reduce((sum, tab) => sum + tab.total, 0);
  const stats = useMemo(() => {
    const [lastMonth, thisMonth] = monthlyRevenue(invoices, 2);
    const total = invoices.reduce((sum, invoice) => sum + Number(invoice.total_amount), 0);
    const change = lastMonth.total ? ((thisMonth.total - lastMonth.total) / lastMonth.total) * 100 : null;
    return {
      total,
      thisMonth,
      change,
      uploaded: gallery.filter(image => !image.id.startsWith('built-in-')).length,
    };
  }, [gallery, invoices]);

  return (
    <div className="view-stack">
      <section className="hero-card stagger" style={stagger(0)}>
        <img src="/images/optimized/craftedwithsoul-1600.webp" alt="" aria-hidden="true" />
        <div className="hero-copy">
          <p className="eyebrow light">{`${new Date().toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' }).toUpperCase()} · ${formatDate(new Date())}`}</p>
          <h2>{greeting()}, welcome back.</h2>
          <p>Here's how Mandarin Orchid is doing at a glance.</p>
          <div className="hero-actions">
            <button type="button" className="primary-button" onClick={() => onNavigate('tabs')}><Icon name="plus" size={15} />Add orders</button>
            <button type="button" className="glass-button" onClick={() => onNavigate('billing')}><Icon name="receipt" size={15} />New invoice</button>
            <button type="button" className="glass-button" onClick={() => onNavigate('gallery')}><Icon name="upload" size={15} />Add photos</button>
            <a className="glass-button" href="/" target="_blank" rel="noopener"><Icon name="globe" size={15} />View website</a>
          </div>
        </div>
      </section>

      <div className="stat-grid">
        <StatCard index={1} icon="rupee" label="Total invoiced" value={stats.total} format={inrRounded} loading={loading}
          foot={`${invoices.length} invoice${invoices.length === 1 ? '' : 's'} on record`} />
        <StatCard index={2} icon="calendar" label="This month" value={stats.thisMonth.total} format={inrRounded} loading={loading}
          foot={<Change value={stats.change} />} />
        <StatCard index={3} icon="clipboard" label="Open tabs" value={tabsTotal} format={inrRounded} loading={openTabs === null}
          foot={openTabs?.length ? <button type="button" className="text-button" onClick={() => onNavigate('tabs')}>{openTabs.map(tab => tab.label).join(', ')} <Icon name="arrowRight" size={12} /></button> : 'No guests with open tabs'} />
        <StatCard index={4} icon="gallery" label="Published photos" value={gallery.length} loading={loading}
          foot={`${stats.uploaded} uploaded by you`} />
      </div>

      <div className="split-grid">
        <section className="panel stagger" style={stagger(5)}>
          <div className="panel-heading">
            <div><p className="eyebrow">REVENUE</p><h2>Invoiced by month</h2></div>
            <Segmented label="Chart range" value={months} onChange={setMonths}
              options={[{ id: '6', label: '6 months' }, { id: '12', label: '12 months' }]} />
          </div>
          <RevenueChart invoices={invoices} months={Number(months)} />
        </section>
        <section className="panel stagger" style={stagger(6)}>
          <div className="panel-heading">
            <div><p className="eyebrow">GALLERY</p><h2>Photo collections</h2></div>
          </div>
          <CategoryBars images={gallery} />
          <button type="button" className="text-button" onClick={() => onNavigate('gallery')}>Manage gallery <Icon name="arrowRight" size={13} /></button>
        </section>
      </div>

      <div className="split-grid">
        <section className="panel stagger" style={stagger(7)}>
          <div className="panel-heading">
            <div><p className="eyebrow">RECENT ACTIVITY</p><h2>Latest invoices</h2></div>
            <button type="button" className="text-button" onClick={() => onNavigate('billing')}>View all <Icon name="arrowRight" size={13} /></button>
          </div>
          <InvoiceTable invoices={invoices.slice(0, 5)} loading={loading} compact />
        </section>
        <section className="panel stagger" style={stagger(8)}>
          <div className="panel-heading">
            <div><p className="eyebrow">LIVE WEBSITE</p><h2>Your website</h2></div>
            <ApiStatus />
          </div>
          <ul className="link-list">
            {websitePages.map(page => (
              <li key={page.href}>
                <a href={page.href} target="_blank" rel="noopener">
                  <span><Icon name="globe" size={15} />{page.label}</span><Icon name="external" size={14} />
                </a>
              </li>
            ))}
          </ul>
          {gallery[0] && <p className="muted small">Latest photo published {shortDate(gallery[0].created_at)}.</p>}
        </section>
      </div>
    </div>
  );
}

function StatCard({ index, icon, label, value, format, foot, loading }: {
  index: number; icon: string; label: string; value: number; format?: (n: number) => string; foot: ReactNode; loading: boolean;
}) {
  return (
    <article className="stat-card stagger" style={stagger(index)}>
      <div className="stat-top"><span className="stat-label">{label}</span><span className="stat-icon"><Icon name={icon} size={17} /></span></div>
      <strong className="stat-value" title={format ? format(value) : String(value)}>
        {loading ? <span className="skeleton" style={{ width: '60%' }} /> : <CountUp value={value} format={format} />}
      </strong>
      <span className="stat-foot">{foot}</span>
    </article>
  );
}

function Change({ value }: { value: number | null }) {
  if (value === null) return <>No invoices last month to compare</>;
  const up = value >= 0;
  return (
    <span className={up ? 'trend up' : 'trend down'}>
      <Icon name={up ? 'trendUp' : 'trendDown'} size={14} />
      {up ? 'Up' : 'Down'} {Math.abs(value).toFixed(0)}% vs last month
    </span>
  );
}

function ApiStatus() {
  const [state, setState] = useState<{ online: boolean; ms: number } | null>(null);
  useEffect(() => {
    const started = performance.now();
    fetch('/api/health', { cache: 'no-store' })
      .then(response => setState({ online: response.ok, ms: Math.round(performance.now() - started) }))
      .catch(() => setState({ online: false, ms: 0 }));
  }, []);
  if (!state) return <span className="status-pill">Checking…</span>;
  return (
    <span className={state.online ? 'status-pill online' : 'status-pill offline'}>
      <span className="dot" />{state.online ? `Online · ${state.ms}ms` : 'Unreachable'}
    </span>
  );
}
