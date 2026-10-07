import { inr, shortDate } from './format';
import { InvoiceSummary } from './types';
import { Icon } from './ui';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();

export function InvoiceTable({ invoices, onDownload, onDelete, onEdit, editingId, downloading, loading, compact, emptyText }: {
  invoices: InvoiceSummary[];
  onDownload?: (invoice: InvoiceSummary) => void;
  onDelete?: (invoice: InvoiceSummary) => void;
  onEdit?: (invoice: InvoiceSummary) => void;
  editingId?: string | null;
  downloading?: string | null;
  loading?: boolean;
  compact?: boolean;
  emptyText?: string;
}) {
  if (loading) {
    return <div className="table-skeleton">{[0, 1, 2].map(row => <span key={row} className="skeleton" />)}</div>;
  }
  if (!invoices.length) {
    return (
      <div className="empty-state">
        <span className="empty-icon"><Icon name="receipt" size={22} /></span>
        <p>{emptyText || 'No invoices yet. Your first invoice will appear here.'}</p>
      </div>
    );
  }
  return (
    <div className="table-scroll">
      <table className={compact ? 'compact' : ''}>
        <thead>
          <tr>
            <th scope="col">Guest</th>
            {!compact && <th scope="col">Invoice</th>}
            <th scope="col">Date</th>
            <th scope="col" className="numeric">Total</th>
            {onDownload && <th scope="col"><span className="visually-hidden">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice, index) => (
            <tr key={invoice.id} className={editingId === invoice.id ? 'editing' : ''} style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}>
              <td>
                <div className="guest-cell">
                  <span className="avatar" aria-hidden="true">{initials(invoice.guest_name)}</span>
                  <span><b>{invoice.guest_name}</b>{compact && <small>{invoice.invoice_number}</small>}</span>
                </div>
              </td>
              {!compact && <td><code>{invoice.invoice_number}</code>{invoice.revision ? <span className="revised-tag">Revised</span> : null}</td>}
              <td>{shortDate(invoice.created_at)}</td>
              <td className="numeric">
                <b>{inr(Number(invoice.total_amount))}</b>
                {invoice.advance_paid ? <small className="balance-note">{invoice.balance_due ? `${inr(invoice.balance_due)} due` : 'Paid in full'}</small> : null}
              </td>
              {onDownload && (
                <td className="actions">
                  <button type="button" className="chip-button" onClick={() => onDownload(invoice)} disabled={downloading === invoice.id}
                    aria-label={`Download invoice ${invoice.invoice_number}`}>
                    <Icon name="download" size={14} />{downloading === invoice.id ? 'Preparing…' : 'PDF'}
                  </button>
                  {onEdit && (
                    <button type="button" className="icon-button" onClick={() => onEdit(invoice)}
                      aria-label={`Edit invoice ${invoice.invoice_number}`} title="Edit invoice">
                      <Icon name="edit" size={15} />
                    </button>
                  )}
                  {onDelete && (
                    <button type="button" className="icon-button danger" onClick={() => onDelete(invoice)}
                      aria-label={`Remove invoice ${invoice.invoice_number}`} title="Remove invoice">
                      <Icon name="trash" size={15} />
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
