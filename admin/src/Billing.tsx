import { DragEvent, FormEvent, Fragment, useMemo, useState } from 'react';
import { api, downloadFile } from './client';
import { inr, shortDate } from './format';
import { InvoiceTable } from './InvoiceTable';
import { InvoiceSummary, Notify } from './types';
import type { NotesImport } from './notes/parseNotes';
import { Icon, Modal, Segmented, Spinner, stagger } from './ui';

type LineItem = { description: string; quantity: string; unitPrice: string; section: string };
type ImportSummary = { fileName: string; count: number; declaredTotal: number | null; skipped: string[] };
type Period = 'all' | 'month' | '30d' | 'year';

const maxLines = 80;
const emptyLine = (description = '', section = ''): LineItem => ({ description, quantity: '1', unitPrice: '', section });
const quickItems = ['Room night', 'Villa night', 'Breakfast', 'Extra bed', 'Bonfire & barbecue', 'Airport transfer'];
const taxPresets = ['0', '5', '12', '18'];

/** Mirrors the server's calculateTotals so the preview matches the generated PDF. */
function totalsFor(lines: LineItem[], taxRate: number) {
  const subtotal = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0), 0);
  const taxAmount = Math.round(subtotal * (taxRate || 0)) / 100;
  return { subtotal: Math.round(subtotal * 100) / 100, taxAmount, total: Math.round((subtotal + taxAmount) * 100) / 100 };
}

function nightsBetween(start: string, end: string) {
  if (!start || !end) return null;
  const nights = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000);
  return nights >= 0 ? nights : null;
}

/** Quotes a CSV cell and neutralises spreadsheet formula injection. */
const csvCell = (value: string | number) => {
  const text = String(value);
  return `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`;
};

export function Billing({ invoices, loading, refresh, notify }: {
  invoices: InvoiceSummary[]; loading: boolean; refresh: () => Promise<void>; notify: Notify;
}) {
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [stayStart, setStayStart] = useState('');
  const [stayEnd, setStayEnd] = useState('');
  const [stayLabel, setStayLabel] = useState('');
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<ImportSummary | null>(null);
  const [draggingNotes, setDraggingNotes] = useState(false);
  const [taxRate, setTaxRate] = useState('0');
  const [lineItems, setLineItems] = useState<LineItem[]>([emptyLine()]);
  const [sourceBill, setSourceBill] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [pendingDelete, setPendingDelete] = useState<InvoiceSummary | null>(null);

  const totals = totalsFor(lineItems, Number(taxRate));
  const nights = nightsBetween(stayStart, stayEnd);
  const mismatch = imported?.declaredTotal != null && Math.abs(imported.declaredTotal - totals.subtotal) > 0.009;

  const records = useMemo(() => {
    const term = query.trim().toLowerCase();
    const now = new Date();
    const since = period === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1)
      : period === '30d' ? new Date(now.getTime() - 30 * 86_400_000)
      : period === 'year' ? new Date(now.getFullYear(), 0, 1)
      : null;
    return invoices.filter(invoice =>
      (!since || new Date(invoice.created_at) >= since)
      && (!term || `${invoice.guest_name} ${invoice.invoice_number} ${invoice.guest_email || ''}`.toLowerCase().includes(term)));
  }, [invoices, query, period]);
  const recordsTotal = records.reduce((sum, invoice) => sum + Number(invoice.total_amount), 0);

  const updateLine = (index: number, patch: Partial<LineItem>) =>
    setLineItems(lines => lines.map((line, i) => i === index ? { ...line, ...patch } : line));

  const addQuickItem = (description: string) => setLineItems(lines => {
    const blank = lines.findIndex(line => !line.description.trim());
    const quantity = description.endsWith('night') && nights ? String(nights) : '1';
    if (blank >= 0) return lines.map((line, i) => i === blank ? { ...line, description, quantity } : line);
    return lines.length >= maxLines ? lines : [...lines, { ...emptyLine(description, lines.at(-1)?.section), quantity }];
  });

  /** Renames every line in a section, e.g. "3 Oct" → "3 Oct · Lunch". */
  const renameSection = (from: string, to: string) =>
    setLineItems(lines => lines.map(line => line.section === from ? { ...line, section: to } : line));

  const importNotes = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      notify('That file is larger than 10 MB. Export the note again and retry.', true);
      return;
    }
    setImporting(true);
    try {
      const { readNotesFile } = await import('./notes/readNotes');
      const result: NotesImport = await readNotesFile(file);
      const lines = result.lines.slice(0, maxLines);
      setLineItems(lines.map(line => ({
        description: line.description, quantity: String(line.quantity), unitPrice: String(line.unitPrice), section: line.section,
      })));
      if (result.stayStart) setStayStart(result.stayStart);
      if (result.stayEnd) setStayEnd(result.stayEnd);
      if (result.stayLabel) setStayLabel(result.stayLabel);
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') setSourceBill(file);
      setImported({
        fileName: file.name,
        count: lines.length,
        declaredTotal: result.declaredTotal,
        skipped: [...result.skipped, ...result.lines.slice(maxLines).map(line => line.source)],
      });
      notify(`Read ${lines.length} items from ${file.name}. Please review before generating.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not read those notes.', true);
    } finally {
      setImporting(false);
    }
  };

  const dropNotes = (event: DragEvent) => {
    event.preventDefault();
    setDraggingNotes(false);
    importNotes(event.dataTransfer.files?.[0]);
  };

  const resetForm = () => {
    setGuestName('');
    setGuestEmail('');
    setStayStart('');
    setStayEnd('');
    setStayLabel('');
    setTaxRate('0');
    setLineItems([emptyLine()]);
    setSourceBill(null);
    setImported(null);
  };

  const downloadInvoice = async (invoice: InvoiceSummary) => {
    setDownloading(invoice.id);
    try {
      await downloadFile(`/api/admin/invoices/${invoice.id}/download`, `${invoice.invoice_number}.pdf`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not download invoice.', true);
    } finally {
      setDownloading(null);
    }
  };

  const generate = async (event: FormEvent) => {
    event.preventDefault();
    if (nights === null) {
      notify('Check-out must be on or after check-in.', true);
      return;
    }
    const form = new FormData();
    form.set('guestName', guestName);
    form.set('guestEmail', guestEmail);
    form.set('stayStart', stayStart);
    form.set('stayEnd', stayEnd);
    form.set('stayLabel', stayLabel);
    form.set('taxRate', taxRate);
    form.set('lineItems', JSON.stringify(lineItems.map(item => ({
      description: item.description, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice),
      ...(item.section.trim() ? { section: item.section.trim() } : {}),
    }))));
    if (sourceBill) form.set('sourceBill', sourceBill);
    setBusy(true);
    try {
      const headers = await downloadFile('/api/admin/invoices', 'invoice.pdf', { method: 'POST', body: form });
      await refresh();
      notify(`Invoice ${headers.get('X-Invoice-Number') || ''} created and downloaded.`);
      resetForm();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not generate invoice.', true);
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    const rows = [
      ['Invoice', 'Guest', 'Email', 'Date', 'Currency', 'Total'],
      ...records.map(invoice => [invoice.invoice_number, invoice.guest_name, invoice.guest_email || '', invoice.created_at.slice(0, 10), invoice.currency, Number(invoice.total_amount).toFixed(2)]),
    ];
    const blob = new Blob([rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mandarin-orchid-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="view-stack">
      <form className="billing-layout" onSubmit={generate}>
        <section className="panel stagger" style={stagger(0)}>
          <div className="panel-heading">
            <div><p className="eyebrow">NEW DOCUMENT</p><h2>Create a branded invoice</h2></div>
            <span className="muted small">PDF · INR</span>
          </div>

          <div className={`notes-import${draggingNotes ? ' dragging' : ''}${importing ? ' busy' : ''}`}
            onDragOver={event => { event.preventDefault(); setDraggingNotes(true); }}
            onDragLeave={() => setDraggingNotes(false)} onDrop={dropNotes}>
            <span className="notes-import-icon">{importing ? <Spinner /> : <Icon name="spark" size={20} />}</span>
            <div>
              <b>{importing ? 'Reading the notes…' : 'Import from staff notes'}</b>
              <span>Drop the PDF exported from the notes app. Items, dates and villa are filled in for you to review.</span>
            </div>
            <span className="chip-button notes-import-button"><Icon name="upload" size={13} />Choose PDF</span>
            <input type="file" accept="application/pdf,.pdf,text/plain,.txt" aria-label="Import staff notes PDF" disabled={importing}
              onChange={event => { importNotes(event.target.files?.[0]); event.target.value = ''; }} />
          </div>

          {imported && (
            <div className={`import-result${imported.skipped.length || mismatch ? ' warn' : ''}`} role="status">
              <Icon name={imported.skipped.length || mismatch ? 'alert' : 'check'} size={16} />
              <div>
                <b>{imported.count} items imported from {imported.fileName}</b>
                {imported.declaredTotal !== null && (
                  mismatch
                    ? <span>The notes say {inr(imported.declaredTotal)} but the items add up to {inr(totals.subtotal)}. Please check the lines.</span>
                    : <span>Items add up to {inr(imported.declaredTotal)}, matching the total in the notes.</span>
                )}
                {imported.skipped.length > 0 && (
                  <span>Not imported, please add manually if needed: {imported.skipped.map(line => `“${line}”`).join(', ')}</span>
                )}
                <span>Add the guest's name, then review and generate.</span>
              </div>
              <button type="button" className="icon-button" onClick={() => setImported(null)} aria-label="Dismiss import summary"><Icon name="close" size={14} /></button>
            </div>
          )}

          <fieldset>
            <legend><span className="step">1</span>Guest & stay</legend>
            <div className="form-row">
              <label>Guest name<input value={guestName} onChange={event => setGuestName(event.target.value)} maxLength={140} autoComplete="off" required /></label>
              <label><span>Guest email <span className="optional">optional</span></span><input type="email" value={guestEmail} onChange={event => setGuestEmail(event.target.value)} maxLength={254} autoComplete="off" /></label>
            </div>
            <div className="form-row">
              <label>Check-in<input type="date" value={stayStart} onChange={event => setStayStart(event.target.value)} required /></label>
              <label>Check-out<input type="date" value={stayEnd} min={stayStart || undefined} onChange={event => setStayEnd(event.target.value)} required /></label>
            </div>
            <div className="form-row">
              <label><span>Room / villa <span className="optional">optional</span></span><input value={stayLabel} onChange={event => setStayLabel(event.target.value)} maxLength={60} placeholder="e.g. Villa 1" autoComplete="off" /></label>
            </div>
          </fieldset>

          <fieldset>
            <legend><span className="step">2</span>Bill items</legend>
            <div className="quick-add" aria-label="Quick add items">
              {quickItems.map(item => (
                <button key={item} type="button" className="chip-button" onClick={() => addQuickItem(item)}><Icon name="plus" size={12} />{item}</button>
              ))}
            </div>
            <div className="line-items">
              {lineItems.map((item, index) => (
                <Fragment key={index}>
                {item.section && item.section !== lineItems[index - 1]?.section && (
                  <div className="line-section">
                    <label className="line-section-name">
                      <span className="visually-hidden">Section name</span>
                      <input value={item.section} maxLength={60} onChange={event => renameSection(item.section, event.target.value)} />
                    </label>
                    <span className="line-section-total">{inr(lineItems.filter(line => line.section === item.section)
                      .reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0), 0))}</span>
                  </div>
                )}
                <div className="line-item">
                  <label>Description<input value={item.description} onChange={event => updateLine(index, { description: event.target.value })} maxLength={180} required /></label>
                  <label>Qty<input type="number" inputMode="numeric" min="1" max="9999" step="1" value={item.quantity} onChange={event => updateLine(index, { quantity: event.target.value })} required /></label>
                  <label>Rate (₹)<input type="number" inputMode="decimal" min="0" max="10000000" step="0.01" value={item.unitPrice} onChange={event => updateLine(index, { unitPrice: event.target.value })} required /></label>
                  <span className="line-amount" aria-label="Line amount">{inr((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0))}</span>
                  <button type="button" className="icon-button danger" aria-label={`Remove line ${index + 1}`} disabled={lineItems.length === 1}
                    onClick={() => setLineItems(lines => lines.filter((_, i) => i !== index))}><Icon name="close" size={15} /></button>
                </div>
                </Fragment>
              ))}
            </div>
            <button type="button" className="text-button" disabled={lineItems.length >= maxLines} onClick={() => setLineItems(lines => [...lines, emptyLine('', lines.at(-1)?.section)])}>
              <Icon name="plus" size={14} />Add another line
            </button>
          </fieldset>

          <fieldset>
            <legend><span className="step">3</span>Tax & records</legend>
            <div className="form-row">
              <div className="field-group">
                <span className="field-label" id="tax-label">Tax rate (%)</span>
                <div className="tax-row">
                  <Segmented label="Tax presets" value={taxPresets.includes(taxRate) ? taxRate : ''} onChange={setTaxRate}
                    options={taxPresets.map(rate => ({ id: rate, label: `${rate}%` }))} />
                  <input aria-labelledby="tax-label" type="number" min="0" max="100" step="0.01" value={taxRate} onChange={event => setTaxRate(event.target.value)} />
                </div>
              </div>
              <div className="field-group">
                <span className="field-label">Original notes / bill <span className="optional">optional PDF, kept private</span></span>
                <label className={sourceBill ? 'file-chip has-file' : 'file-chip'}>
                  <Icon name="file" size={15} /><span>{sourceBill ? sourceBill.name : 'Attach PDF'}</span>
                  <input type="file" accept="application/pdf,.pdf" onChange={event => setSourceBill(event.target.files?.[0] || null)} />
                </label>
              </div>
            </div>
          </fieldset>
        </section>

        <aside className="summary-card stagger" style={stagger(1)} aria-label="Invoice summary">
          <p className="eyebrow light">INVOICE PREVIEW</p>
          <h3>{guestName || 'Guest name'}</h3>
          <p className="summary-stay">
            <Icon name="calendar" size={14} />
            {[stayLabel, nights === null ? 'Select stay dates' : `${nights} night${nights === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
          </p>
          {imported?.declaredTotal != null && (
            <p className={mismatch ? 'summary-check warn' : 'summary-check'}>
              <Icon name={mismatch ? 'alert' : 'check'} size={13} />{mismatch ? 'Differs from the notes total' : 'Matches the notes total'}
            </p>
          )}
          <dl>
            <div><dt>Items</dt><dd>{lineItems.filter(line => line.description.trim()).length}</dd></div>
            <div><dt>Subtotal</dt><dd>{inr(totals.subtotal)}</dd></div>
            <div><dt>Tax ({Number(taxRate) || 0}%)</dt><dd>{inr(totals.taxAmount)}</dd></div>
            <div className="grand"><dt>Total</dt><dd key={totals.total} className="pulse">{inr(totals.total)}</dd></div>
          </dl>
          <button className="primary-button wide" disabled={busy}>
            {busy ? <><Spinner /> Preparing PDF…</> : <><Icon name="download" size={15} />Generate & download</>}
          </button>
          <button type="button" className="glass-button wide" onClick={resetForm} disabled={busy}>Clear form</button>
          <p className="summary-note"><Icon name="lock" size={12} /> Stored privately. Not emailed to the guest.</p>
        </aside>
      </form>

      <section className="panel stagger" style={stagger(2)}>
        <div className="panel-heading">
          <div><p className="eyebrow">RECORDS</p><h2>Invoice history</h2></div>
          <button type="button" className="ghost-button" onClick={exportCsv} disabled={!records.length}><Icon name="download" size={14} />Export CSV</button>
        </div>
        <div className="toolbar">
          <label className="search-field">
            <span className="visually-hidden">Search invoices</span>
            <Icon name="search" size={15} />
            <input type="search" placeholder="Search guest, email or invoice number…" value={query} onChange={event => setQuery(event.target.value)} />
          </label>
          <Segmented label="Time period" value={period} onChange={setPeriod} options={[
            { id: 'all', label: 'All time' }, { id: 'month', label: 'This month' }, { id: '30d', label: '30 days' }, { id: 'year', label: 'This year' },
          ]} />
        </div>
        <p className="records-summary">{records.length} invoice{records.length === 1 ? '' : 's'} · <b>{inr(recordsTotal)}</b></p>
        <InvoiceTable invoices={records} onDownload={downloadInvoice} onDelete={setPendingDelete} downloading={downloading} loading={loading}
          emptyText={invoices.length ? 'No invoices match this search.' : undefined} />
      </section>

      {pendingDelete && (
        <DeleteInvoiceDialog invoice={pendingDelete} onCancel={() => setPendingDelete(null)}
          onDeleted={async () => {
            const removed = pendingDelete;
            setPendingDelete(null);
            notify(`Invoice ${removed.invoice_number} was removed.`);
            await refresh().catch(() => {});
          }} />
      )}
    </div>
  );
}

/** Removing a billing record needs the admin password again; the server enforces this. */
function DeleteInvoiceDialog({ invoice, onCancel, onDeleted }: {
  invoice: InvoiceSummary; onCancel: () => void; onDeleted: () => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/api/admin/invoices/${invoice.id}`, { method: 'DELETE', body: JSON.stringify({ password }) });
      onDeleted();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not remove the invoice.');
      setPassword('');
      setBusy(false);
    }
  };

  return (
    <Modal title="Remove invoice" onClose={busy ? () => {} : onCancel}>
      <form className="confirm" onSubmit={confirm}>
        <span className="confirm-icon"><Icon name="lock" size={22} /></span>
        <h2>Remove this invoice?</h2>
        <div className="delete-summary">
          <b>{invoice.guest_name}</b>
          <span>{invoice.invoice_number} · {shortDate(invoice.created_at)}</span>
          <strong>{inr(Number(invoice.total_amount))}</strong>
        </div>
        <p className="muted">The PDF and its record will be permanently deleted. Enter the admin password to confirm.</p>
        <label className="confirm-field">
          <span className="visually-hidden">Admin password</span>
          <div className="password-field">
            <Icon name="lock" size={16} />
            <input type="password" autoComplete="current-password" placeholder="Admin password" value={password}
              onChange={event => setPassword(event.target.value)} required data-autofocus
              aria-invalid={Boolean(error)} aria-describedby={error ? 'delete-error' : undefined} />
          </div>
        </label>
        {error && <p className="field-error" id="delete-error" role="alert"><Icon name="alert" size={14} />{error}</p>}
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onCancel} disabled={busy}>Keep invoice</button>
          <button className="danger-button" disabled={busy || !password}>
            {busy ? <><Spinner /> Removing…</> : <><Icon name="trash" size={14} />Remove permanently</>}
          </button>
        </div>
      </form>
    </Modal>
  );
}
