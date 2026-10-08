import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './client';
import { dayLabel, formatDateTime, shortDate } from './format';
import { Notify } from './types';
import { ConfirmDialog, Icon, Segmented, stagger } from './ui';

type Status = 'new' | 'contacted' | 'booked' | 'closed';
type Enquiry = {
  id: string; source: 'contact' | 'booking'; name: string; email: string; phone: string;
  check_in: string; check_out: string; room: string; guests: string; message: string;
  status: Status; note: string; created_at: string;
};

const statusLabels: Record<Status, string> = { new: 'New', contacted: 'Contacted', booked: 'Booked', closed: 'Closed' };

const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  return shortDate(iso);
};

/** Indian mobile numbers are often written without the country code. */
const whatsappNumber = (phone: string) => {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 ? `91${digits}` : digits;
};

function stayText(enquiry: Enquiry) {
  if (!enquiry.check_in && !enquiry.check_out) return '';
  if (enquiry.check_in && enquiry.check_out) {
    const nights = Math.round((Date.parse(enquiry.check_out) - Date.parse(enquiry.check_in)) / 86_400_000);
    return `${dayLabel(enquiry.check_in)} → ${dayLabel(enquiry.check_out)} · ${nights} night${nights === 1 ? '' : 's'}`;
  }
  return enquiry.check_in ? `From ${dayLabel(enquiry.check_in)}` : `Until ${dayLabel(enquiry.check_out)}`;
}

export function EnquiriesPage({ notify, onNewChange }: { notify: Notify; onNewChange: (count: number) => void }) {
  const [enquiries, setEnquiries] = useState<Enquiry[] | null>(null);
  const [filter, setFilter] = useState<Status | 'all'>('new');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<Enquiry | null>(null);

  const load = useCallback(async () => {
    try {
      const list = (await api<{ enquiries: Enquiry[] }>('/api/admin/enquiries')).enquiries;
      setEnquiries(list);
      onNewChange(list.filter(enquiry => enquiry.status === 'new').length);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not load enquiries.', true);
    }
  }, [notify, onNewChange]);

  useEffect(() => { load(); }, [load]);
  // New enquiries can arrive at any time; check every minute while this page is open.
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) load(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const counts = useMemo(() => {
    const result: Record<Status, number> = { new: 0, contacted: 0, booked: 0, closed: 0 };
    enquiries?.forEach(enquiry => { result[enquiry.status] += 1; });
    return result;
  }, [enquiries]);

  useEffect(() => {
    if (enquiries && filter === 'new' && !counts.new && enquiries.length) setFilter('all');
  }, [enquiries, counts, filter]);

  const term = query.trim().toLowerCase();
  const visible = (enquiries || []).filter(enquiry =>
    (filter === 'all' || enquiry.status === filter)
    && (!term || `${enquiry.name} ${enquiry.email} ${enquiry.phone} ${enquiry.room} ${enquiry.message}`.toLowerCase().includes(term)));

  const patch = async (enquiry: Enquiry, body: Partial<Pick<Enquiry, 'status' | 'note'>>, message?: string) => {
    setBusy(enquiry.id);
    try {
      const updated = await api<Enquiry>(`/api/admin/enquiries/${enquiry.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setEnquiries(list => {
        const next = (list || []).map(item => item.id === updated.id ? updated : item);
        onNewChange(next.filter(item => item.status === 'new').length);
        return next;
      });
      if (message) notify(message);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update the enquiry.', true);
    } finally {
      setBusy(null);
    }
  };

  const saveNote = (enquiry: Enquiry) => {
    const note = notes[enquiry.id];
    if (note === undefined || note === enquiry.note) return;
    patch(enquiry, { note }, 'Note saved.');
  };

  const remove = async () => {
    if (!pendingDelete) return;
    try {
      await api(`/api/admin/enquiries/${pendingDelete.id}`, { method: 'DELETE' });
      setPendingDelete(null);
      await load();
      notify('Enquiry deleted.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not delete the enquiry.', true);
    }
  };

  return (
    <div className="view-stack">
      <section className="panel stagger" style={stagger(0)}>
        <div className="panel-heading">
          <div><p className="eyebrow">LEADS</p><h2>Guest enquiries</h2></div>
          <span className="muted small">From the contact form and the homepage booking bar</span>
        </div>
        <div className="toolbar">
          <label className="search-field">
            <span className="visually-hidden">Search enquiries</span>
            <Icon name="search" size={15} />
            <input type="search" placeholder="Search name, phone, room or message…" value={query} onChange={event => setQuery(event.target.value)} />
          </label>
          <Segmented label="Enquiry status" value={filter} onChange={setFilter} options={[
            { id: 'new', label: 'New', count: counts.new },
            { id: 'contacted', label: 'Contacted', count: counts.contacted },
            { id: 'booked', label: 'Booked', count: counts.booked },
            { id: 'closed', label: 'Closed', count: counts.closed },
            { id: 'all', label: 'All', count: enquiries?.length ?? 0 },
          ]} />
        </div>

        {!enquiries ? (
          <div className="table-skeleton">{[0, 1, 2].map(row => <span key={row} className="skeleton" />)}</div>
        ) : visible.length ? (
          <ul className="enquiry-list">
            {visible.map((enquiry, index) => {
              const stay = stayText(enquiry);
              const phone = whatsappNumber(enquiry.phone);
              return (
                <li key={enquiry.id} className={`enquiry status-${enquiry.status}${busy === enquiry.id ? ' busy' : ''}`} style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}>
                  <div className="enquiry-top">
                    <div>
                      <b className="enquiry-name">{enquiry.name || 'Website visitor'}</b>
                      <span className={`source-tag ${enquiry.source}`}>{enquiry.source === 'contact' ? 'Contact form' : 'Booking bar · continued on WhatsApp'}</span>
                    </div>
                    <span className="muted small" title={formatDateTime(enquiry.created_at)}>{ago(enquiry.created_at)}</span>
                  </div>

                  <div className="enquiry-facts">
                    {stay && <span><Icon name="calendar" size={14} />{stay}</span>}
                    {enquiry.room && <span><Icon name="overview" size={14} />{enquiry.room}</span>}
                    {enquiry.guests && <span><Icon name="clipboard" size={14} />{enquiry.guests}</span>}
                  </div>

                  {enquiry.message && <p className="enquiry-message">{enquiry.message}</p>}

                  {(enquiry.phone || enquiry.email) && (
                    <div className="enquiry-contact">
                      {enquiry.phone && <a className="chip-button" href={`tel:${enquiry.phone.replace(/[^\d+]/g, '')}`}><Icon name="phone" size={13} />{enquiry.phone}</a>}
                      {phone && <a className="chip-button whatsapp" href={`https://wa.me/${phone}?text=${encodeURIComponent(`Hello ${enquiry.name || ''}, thank you for your enquiry with Mandarin Orchid Resort.`)}`} target="_blank" rel="noopener"><Icon name="external" size={13} />WhatsApp</a>}
                      {enquiry.email && <a className="chip-button" href={`mailto:${enquiry.email}?subject=${encodeURIComponent('Your enquiry with Mandarin Orchid Resort')}`}><Icon name="mail" size={13} />{enquiry.email}</a>}
                    </div>
                  )}

                  <div className="enquiry-actions">
                    <Segmented label="Status" value={enquiry.status} onChange={status => patch(enquiry, { status }, `Marked as ${statusLabels[status].toLowerCase()}.`)}
                      options={(Object.keys(statusLabels) as Status[]).map(status => ({ id: status, label: statusLabels[status] }))} />
                    <button type="button" className="icon-button danger" onClick={() => setPendingDelete(enquiry)} aria-label={`Delete enquiry from ${enquiry.name || 'website visitor'}`}><Icon name="trash" size={15} /></button>
                  </div>
                  <label className="enquiry-note">
                    <span className="visually-hidden">Private note</span>
                    <textarea rows={1} maxLength={1000} placeholder="Private note for the team, e.g. called, sent quote…"
                      value={notes[enquiry.id] ?? enquiry.note} onChange={event => setNotes({ ...notes, [enquiry.id]: event.target.value })} onBlur={() => saveNote(enquiry)} />
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="empty-state">
            <span className="empty-icon"><Icon name="mail" size={22} /></span>
            <p>{enquiries.length ? 'No enquiries match this view.' : 'No enquiries yet. They appear here when guests use the contact form or booking bar.'}</p>
          </div>
        )}
      </section>

      {pendingDelete && (
        <ConfirmDialog title="Delete this enquiry?" confirmLabel="Delete enquiry"
          body={<>The enquiry from {pendingDelete.name || 'a website visitor'} will be removed for good. To keep it but mark it done, set it to Closed instead.</>}
          onConfirm={remove} onCancel={() => setPendingDelete(null)} />
      )}
    </div>
  );
}
