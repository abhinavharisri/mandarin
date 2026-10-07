import { useEffect, useMemo, useState } from 'react';
import { TrendChart } from './charts';
import { api, downloadFile } from './client';
import { downloadCsv, inr, inrRounded, resortNow, shortDate } from './format';
import { Notify, Report } from './types';
import { CountUp, Icon, Segmented, Spinner, stagger } from './ui';

type Preset = 'this-month' | 'last-month' | 'last-3' | 'this-year' | 'custom';
const presets: { id: Preset; label: string }[] = [
  { id: 'this-month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: 'last-3', label: 'Last 3 months' },
  { id: 'this-year', label: 'This year' },
  { id: 'custom', label: 'Custom' },
];

const sources = [
  { key: 'food', label: 'Food & beverages' },
  { key: 'room', label: 'Room & stay' },
  { key: 'extras', label: 'Activities & extras' },
  { key: 'tax', label: 'Tax' },
  { key: 'unitemised', label: 'Not itemised' },
] as const;

const iso = (date: Date) => date.toISOString().slice(0, 10);

function presetRange(preset: Exclude<Preset, 'custom'>) {
  const [year, month] = resortNow().date.split('-').map(Number);
  const first = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1));
  const last = (y: number, m: number) => new Date(Date.UTC(y, m, 0));
  if (preset === 'this-month') return { from: iso(first(year, month)), to: iso(last(year, month)) };
  if (preset === 'last-month') return { from: iso(first(year, month - 1)), to: iso(last(year, month - 1)) };
  if (preset === 'last-3') return { from: iso(first(year, month - 2)), to: iso(last(year, month)) };
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

const longDate = (value: string) => shortDate(`${value}T12:00:00Z`);

export function Reports({ notify }: { notify: Notify }) {
  const [preset, setPreset] = useState<Preset>('this-month');
  const [custom, setCustom] = useState(() => presetRange('this-month'));
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const range = preset === 'custom' ? custom : presetRange(preset);
  const validRange = Boolean(range.from && range.to && range.from <= range.to);

  useEffect(() => {
    if (!validRange) return;
    let cancelled = false;
    setLoading(true);
    api<Report>(`/api/admin/reports?from=${range.from}&to=${range.to}`)
      .then(next => { if (!cancelled) setReport(next); })
      .catch(error => notify(error instanceof Error ? error.message : 'Could not build the report.', true))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range.from, range.to, validRange, notify]);

  const buckets = useMemo(() => (report?.trend || []).map(entry => ({
    ...entry,
    fullLabel: report?.granularity === 'day' ? longDate(entry.key) : entry.label,
  })), [report]);

  const fileStem = `mandarin-orchid-${range.from}-to-${range.to}`;

  const exportPdf = async () => {
    setExporting(true);
    try {
      await downloadFile(`/api/admin/reports/pdf?from=${range.from}&to=${range.to}`, `${fileStem}.pdf`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not create the PDF report.', true);
    } finally {
      setExporting(false);
    }
  };

  const exportInvoices = () => report && downloadCsv(`${fileStem}-invoices.csv`, [
    ['Date', 'Invoice', 'Guest', 'Villa / room', 'Subtotal', 'Tax', 'Total'],
    ...report.register.map(row => [row.date, row.invoice_number, row.guest_name, row.stay_label, row.subtotal?.toFixed(2) ?? '', row.tax?.toFixed(2) ?? '', row.total.toFixed(2)]),
  ]);

  const exportLines = () => report && downloadCsv(`${fileStem}-line-items.csv`, [
    ['Date', 'Invoice', 'Villa / room', 'Section', 'Category', 'Item', 'Quantity', 'Rate', 'Amount'],
    ...report.lines.map(line => [line.date, line.invoice_number, line.stay_label, line.section, line.category, line.description, line.quantity, line.unit_price.toFixed(2), line.amount.toFixed(2)]),
  ]);

  const totals = report?.totals;
  const maxStay = Math.max(1, ...(report?.byStay || []).map(stay => stay.total));

  return (
    <div className="view-stack reports">
      <section className="panel stagger" style={stagger(0)}>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">REPORTS</p>
            <h2>{validRange ? `${longDate(range.from)} – ${longDate(range.to)}` : 'Choose a date range'}</h2>
          </div>
          <div className="export-actions">
            <button type="button" className="primary-button small" onClick={exportPdf} disabled={!report || exporting || !validRange}>
              {exporting ? <><Spinner /> Preparing…</> : <><Icon name="download" size={14} />PDF report</>}
            </button>
            <button type="button" className="ghost-button" onClick={exportInvoices} disabled={!report?.register.length}><Icon name="download" size={14} />Invoices CSV</button>
            <button type="button" className="ghost-button" onClick={exportLines} disabled={!report?.lines.length}><Icon name="download" size={14} />Line items CSV</button>
          </div>
        </div>
        <div className="toolbar report-toolbar">
          <Segmented label="Report period" value={preset} onChange={setPreset} options={presets} />
          {preset === 'custom' && (
            <div className="date-range">
              <label><span className="visually-hidden">From</span><input type="date" value={custom.from} max={custom.to || undefined} onChange={event => setCustom({ ...custom, from: event.target.value })} /></label>
              <span aria-hidden="true">→</span>
              <label><span className="visually-hidden">To</span><input type="date" value={custom.to} min={custom.from || undefined} onChange={event => setCustom({ ...custom, to: event.target.value })} /></label>
            </div>
          )}
        </div>
      </section>

      <div className="stat-grid">
        {([
          ['rupee', 'Revenue', totals?.revenue ?? 0, inrRounded, `${totals?.invoices ?? 0} invoice${totals?.invoices === 1 ? '' : 's'}`],
          ['receipt', 'Invoices', totals?.invoices ?? 0, undefined, report ? `${report.byStay.filter(stay => stay.label !== 'Not recorded').length} villas / rooms billed` : ''],
          ['billing', 'Average bill', totals?.average ?? 0, inrRounded, 'Per invoice, including tax'],
          ['shield', 'Tax collected', totals?.tax ?? 0, inrRounded, 'From itemised invoices'],
        ] as const).map(([icon, label, value, format, foot], index) => (
          <article key={label} className="stat-card stagger" style={stagger(index + 1)}>
            <div className="stat-top"><span className="stat-label">{label}</span><span className="stat-icon"><Icon name={icon} size={17} /></span></div>
            <strong className="stat-value">{loading && !report ? <span className="skeleton" style={{ width: '60%' }} /> : <CountUp value={value} format={format} />}</strong>
            <span className="stat-foot">{foot}</span>
          </article>
        ))}
      </div>

      <div className="split-grid">
        <section className={loading ? 'panel stagger is-loading' : 'panel stagger'} style={stagger(5)}>
          <div className="panel-heading">
            <div><p className="eyebrow">TREND</p><h2>{report?.granularity === 'month' ? 'Revenue by month' : 'Revenue by day'}</h2></div>
          </div>
          {report ? <TrendChart buckets={buckets} label="Revenue over the selected period" /> : <span className="skeleton chart-skeleton" />}
        </section>

        <section className={loading ? 'panel stagger is-loading' : 'panel stagger'} style={stagger(6)}>
          <div className="panel-heading"><div><p className="eyebrow">SPLIT</p><h2>Revenue by source</h2></div></div>
          {totals && totals.revenue > 0 ? (
            <>
              <div className="source-bar" role="img" aria-label={sources.filter(source => totals[source.key] > 0).map(source => `${source.label} ${inr(totals[source.key])}`).join(', ')}>
                {sources.filter(source => totals[source.key] > 0).map((source, index) => (
                  <span key={source.key} className={`source-segment ${source.key}`} title={`${source.label}: ${inr(totals[source.key])}`}
                    style={{ flexGrow: totals[source.key], animationDelay: `${index * 80}ms` }} />
                ))}
              </div>
              <ul className="source-legend">
                {sources.filter(source => totals[source.key] > 0).map(source => (
                  <li key={source.key}>
                    <span className={`legend-dot ${source.key}`} aria-hidden="true" />
                    <span className="legend-label">{source.label}</span>
                    <span className="legend-share">{Math.round((totals[source.key] / totals.revenue) * 100)}%</span>
                    <b>{inr(totals[source.key])}</b>
                  </li>
                ))}
              </ul>
              {totals.unitemisedInvoices > 0 && (
                <p className="muted small">{totals.unitemisedInvoices} older invoice{totals.unitemisedInvoices === 1 ? ' was' : 's were'} created before itemised records, so {totals.unitemisedInvoices === 1 ? 'it counts' : 'they count'} toward totals only.</p>
              )}
            </>
          ) : (
            <div className="empty-state"><span className="empty-icon"><Icon name="overview" size={22} /></span><p>No revenue in this period.</p></div>
          )}
        </section>
      </div>

      <div className="split-grid even">
        <section className="panel stagger" style={stagger(7)}>
          <div className="panel-heading"><div><p className="eyebrow">VILLAS & ROOMS</p><h2>Revenue by villa</h2></div></div>
          {report?.byStay.length ? (
            <ul className="category-bars">
              {report.byStay.map((stay, index) => (
                <li key={stay.label} title={`${stay.label}: ${inr(stay.total)} from ${stay.count} invoices`}>
                  <div className="category-bars-label"><span>{stay.label} <small className="muted">· {stay.count} invoice{stay.count === 1 ? '' : 's'}</small></span><strong>{inrRounded(stay.total)}</strong></div>
                  <div className="category-bars-track" role="img" aria-label={`${stay.label}: ${inr(stay.total)}`}>
                    <div className="category-bars-fill" style={{ width: `${(stay.total / maxStay) * 100}%`, animationDelay: `${index * 70}ms` }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="empty-state">No invoices in this period.</p>}
        </section>

        <section className="panel stagger" style={stagger(8)}>
          <div className="panel-heading"><div><p className="eyebrow">KITCHEN</p><h2>Best sellers</h2></div></div>
          {report?.topItems.length ? (
            <div className="table-scroll">
              <table className="compact">
                <thead><tr><th scope="col">#</th><th scope="col">Item</th><th scope="col" className="numeric">Qty</th><th scope="col" className="numeric">Revenue</th></tr></thead>
                <tbody>
                  {report.topItems.map((item, index) => (
                    <tr key={item.name} style={{ animationDelay: `${index * 35}ms` }}>
                      <td className="rank">{index + 1}</td><td>{item.name}</td><td className="numeric">{item.quantity}</td><td className="numeric"><b>{inr(item.revenue)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="empty-state">Best sellers appear once itemised invoices are created.</p>}
        </section>
      </div>

      <section className="panel stagger" style={stagger(9)}>
        <div className="panel-heading"><div><p className="eyebrow">REGISTER</p><h2>Invoices in this period</h2></div></div>
        {report?.register.length ? (
          <div className="table-scroll">
            <table>
              <thead><tr><th scope="col">Date</th><th scope="col">Invoice</th><th scope="col">Guest</th><th scope="col">Villa / room</th><th scope="col" className="numeric">Tax</th><th scope="col" className="numeric">Total</th></tr></thead>
              <tbody>
                {report.register.map((row, index) => (
                  <tr key={row.id} style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}>
                    <td>{longDate(row.date)}</td><td><code>{row.invoice_number}</code></td><td>{row.guest_name}</td><td>{row.stay_label || '—'}</td>
                    <td className="numeric">{row.tax === null ? '—' : inr(row.tax)}</td><td className="numeric"><b>{inr(row.total)}</b></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={5}>Total</td><td className="numeric"><b>{inr(report.totals.revenue)}</b></td></tr></tfoot>
            </table>
          </div>
        ) : <p className="empty-state">No invoices in this period.</p>}
      </section>
    </div>
  );
}
