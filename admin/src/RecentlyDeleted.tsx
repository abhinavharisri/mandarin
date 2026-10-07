import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { api, downloadFile } from './client';
import { inr, shortDate } from './format';
import { InvoiceSummary, Notify } from './types';
import { Icon, Modal, Spinner, stagger } from './ui';

type DeletedInvoice = InvoiceSummary & { deleted_at: string; expires_at: string };

const daysLeft = (expiresAt: string) => Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000));

/** Invoices removed from the history, restorable for 30 days. */
export function RecentlyDeleted({ version, onRestored, notify }: { version: number; onRestored: () => Promise<void>; notify: Notify }) {
  const [items, setItems] = useState<DeletedInvoice[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ invoice: DeletedInvoice | null } | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ items: DeletedInvoice[] }>('/api/admin/trash')).items);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not load recently deleted invoices.', true);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load, version]);

  const restore = async (invoice: DeletedInvoice) => {
    setBusy(invoice.id);
    try {
      await api(`/api/admin/trash/${invoice.id}/restore`, { method: 'POST' });
      await Promise.all([load(), onRestored()]);
      notify(`Invoice ${invoice.invoice_number} was restored to the invoice history.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not restore the invoice.', true);
    } finally {
      setBusy(null);
    }
  };

  const download = async (invoice: DeletedInvoice) => {
    setBusy(invoice.id);
    try {
      await downloadFile(`/api/admin/trash/${invoice.id}/download`, `${invoice.invoice_number}.pdf`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not download the invoice.', true);
    } finally {
      setBusy(null);
    }
  };

  const deleteForever = async (password: string) => {
    const invoice = confirm?.invoice;
    await api(invoice ? `/api/admin/trash/${invoice.id}` : '/api/admin/trash', { method: 'DELETE', body: JSON.stringify({ password }) });
    setConfirm(null);
    await load();
    notify(invoice ? `Invoice ${invoice.invoice_number} was deleted forever.` : 'Recently deleted was emptied.');
  };

  return (
    <section className="panel stagger recently-deleted" style={stagger(3)}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">RECOVERY</p>
          <h2>Recently deleted{items?.length ? ` (${items.length})` : ''}</h2>
        </div>
        {items && items.length > 0 && (
          <button type="button" className="ghost-button danger-text" onClick={() => setConfirm({ invoice: null })}><Icon name="trash" size={14} />Empty bin</button>
        )}
      </div>
      <p className="muted small bin-help">Deleted invoices stay here for 30 days. Restoring brings an invoice back with its original number; after 30 days it is removed for good.</p>
      {!items ? (
        <div className="table-skeleton"><span className="skeleton" /></div>
      ) : items.length ? (
        <ul className="bin-list">
          {items.map(invoice => {
            const left = daysLeft(invoice.expires_at);
            return (
              <li key={invoice.id} className={busy === invoice.id ? 'busy' : ''}>
                <div className="bin-main">
                  <b>{invoice.guest_name}{invoice.stay_label ? <span className="muted"> · {invoice.stay_label}</span> : null}</b>
                  <small><code>{invoice.invoice_number}</code> · issued {shortDate(invoice.created_at)} · deleted {shortDate(invoice.deleted_at)}</small>
                </div>
                <strong className="bin-total">{inr(Number(invoice.total_amount))}</strong>
                <span className={left <= 5 ? 'bin-days soon' : 'bin-days'}>{left === 0 ? 'Deleting today' : `${left} day${left === 1 ? '' : 's'} left`}</span>
                <div className="bin-actions">
                  <button type="button" className="primary-button small" onClick={() => restore(invoice)} disabled={busy === invoice.id}>
                    {busy === invoice.id ? <Spinner /> : <Icon name="arrowLeft" size={13} />}Restore
                  </button>
                  <button type="button" className="icon-button" onClick={() => download(invoice)} disabled={busy === invoice.id} aria-label={`Download ${invoice.invoice_number}`} title="Download PDF"><Icon name="download" size={15} /></button>
                  <button type="button" className="icon-button danger" onClick={() => setConfirm({ invoice })} disabled={busy === invoice.id} aria-label={`Delete ${invoice.invoice_number} forever`} title="Delete forever"><Icon name="trash" size={15} /></button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="empty-state compact">Nothing here. Deleted invoices appear here and can be restored for 30 days.</p>
      )}

      {confirm && (
        <PasswordDialog
          title={confirm.invoice ? 'Delete this invoice forever?' : 'Empty Recently deleted?'}
          body={confirm.invoice
            ? <>Invoice <b>{confirm.invoice.invoice_number}</b> for {confirm.invoice.guest_name} ({inr(Number(confirm.invoice.total_amount))}) and its PDF will be removed for good. This cannot be undone.</>
            : <>All {items?.length} invoices here and their PDFs will be removed for good. This cannot be undone.</>}
          confirmLabel={confirm.invoice ? 'Delete forever' : 'Empty bin'}
          onConfirm={deleteForever} onCancel={() => setConfirm(null)} />
      )}
    </section>
  );
}

/** Asks for the admin password before an action the server also protects with it. */
export function PasswordDialog({ title, body, confirmLabel, onConfirm, onCancel }: {
  title: string; body: ReactNode; confirmLabel: string; onConfirm: (password: string) => Promise<void>; onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onConfirm(password);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That did not work. Please try again.');
      setPassword('');
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={busy ? () => {} : onCancel}>
      <form className="confirm" onSubmit={submit}>
        <span className="confirm-icon"><Icon name="lock" size={22} /></span>
        <h2>{title}</h2>
        <p className="muted">{body} Enter the admin password to confirm.</p>
        <label className="confirm-field">
          <span className="visually-hidden">Admin password</span>
          <div className="password-field">
            <Icon name="lock" size={16} />
            <input type="password" autoComplete="current-password" placeholder="Admin password" value={password}
              onChange={event => setPassword(event.target.value)} required data-autofocus aria-invalid={Boolean(error)} />
          </div>
        </label>
        {error && <p className="field-error" role="alert"><Icon name="alert" size={14} />{error}</p>}
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="danger-button" disabled={busy || !password}>{busy ? <><Spinner /> Working…</> : <><Icon name="trash" size={14} />{confirmLabel}</>}</button>
        </div>
      </form>
    </Modal>
  );
}
