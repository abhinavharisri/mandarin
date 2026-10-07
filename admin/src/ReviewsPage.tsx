import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './client';
import { shortDate } from './format';
import { Notify } from './types';
import { ConfirmDialog, Icon, Segmented, stagger } from './ui';

type Status = 'pending' | 'approved' | 'hidden';
type Review = { id: string; name: string; rating: number; text: string; stay: string; visited: string; status: Status; featured: boolean; created_at: string };
type ReviewList = { summary: { average: number; count: number }; reviews: Review[] };

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const visitedLabel = (visited: string) => {
  if (!visited) return '';
  const [year, month] = visited.split('-').map(Number);
  return `${monthNames[month - 1]} ${year}`;
};

/** Public link guests can be sent; works on any domain the dashboard runs on. */
const reviewLink = () => `${window.location.origin}/reviews`;

function Stars({ rating }: { rating: number }) {
  return (
    <span className="admin-stars" role="img" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map(value => <span key={value} className={value <= rating ? 'on' : ''} aria-hidden="true">★</span>)}
    </span>
  );
}

export function ReviewsPage({ notify, onPendingChange }: { notify: Notify; onPendingChange: (count: number) => void }) {
  const [data, setData] = useState<ReviewList | null>(null);
  const [filter, setFilter] = useState<Status>('pending');
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Review | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api<ReviewList>('/api/admin/reviews');
      setData(next);
      onPendingChange(next.reviews.filter(review => review.status === 'pending').length);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not load reviews.', true);
    }
  }, [notify, onPendingChange]);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const result: Record<Status, number> = { pending: 0, approved: 0, hidden: 0 };
    data?.reviews.forEach(review => { result[review.status] += 1; });
    return result;
  }, [data]);

  // Open on the pending queue when there is one, otherwise on what is published.
  useEffect(() => {
    if (data && filter === 'pending' && !counts.pending && counts.approved) setFilter('approved');
  }, [data, counts, filter]);

  const update = async (review: Review, patch: Partial<Pick<Review, 'status' | 'featured'>>, message: string) => {
    setBusy(review.id);
    try {
      await api(`/api/admin/reviews/${review.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      await load();
      notify(message);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update the review.', true);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    try {
      await api(`/api/admin/reviews/${pendingDelete.id}`, { method: 'DELETE' });
      setPendingDelete(null);
      await load();
      notify('Review deleted.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not delete the review.', true);
    }
  };

  const visible = (data?.reviews || []).filter(review => review.status === filter);

  return (
    <div className="view-stack">
      <ShareCard notify={notify} average={data?.summary.average ?? 0} count={data?.summary.count ?? 0} />

      <section className="panel stagger" style={stagger(1)}>
        <div className="panel-heading">
          <div><p className="eyebrow">GUEST REVIEWS</p><h2>Moderation</h2></div>
          <a className="ghost-button" href="/reviews" target="_blank" rel="noopener"><Icon name="external" size={14} />View reviews page</a>
        </div>
        <div className="toolbar">
          <Segmented label="Review status" value={filter} onChange={setFilter} options={[
            { id: 'pending', label: 'Waiting', count: counts.pending },
            { id: 'approved', label: 'Published', count: counts.approved },
            { id: 'hidden', label: 'Hidden', count: counts.hidden },
          ]} />
        </div>

        {!data ? (
          <div className="table-skeleton">{[0, 1, 2].map(row => <span key={row} className="skeleton" />)}</div>
        ) : visible.length ? (
          <ul className="review-queue">
            {visible.map((review, index) => (
              <li key={review.id} className={busy === review.id ? 'busy' : ''} style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}>
                <div className="review-queue-top">
                  <Stars rating={review.rating} />
                  {review.featured && <span className="revised-tag">Featured</span>}
                  <span className="muted small">{shortDate(review.created_at)}</span>
                </div>
                <p className="review-queue-text">{review.text}</p>
                <p className="review-queue-author">
                  <b>{review.name}</b>
                  {[review.stay, visitedLabel(review.visited)].filter(Boolean).length > 0 && <span className="muted"> · {[review.stay, visitedLabel(review.visited)].filter(Boolean).join(' · ')}</span>}
                </p>
                <div className="review-queue-actions">
                  {review.status !== 'approved' && (
                    <button type="button" className="primary-button small" disabled={busy === review.id}
                      onClick={() => update(review, { status: 'approved' }, `Review by ${review.name} is now on the website.`)}>
                      <Icon name="check" size={14} />{review.status === 'hidden' ? 'Publish again' : 'Approve'}
                    </button>
                  )}
                  {review.status === 'approved' && (
                    <button type="button" className={review.featured ? 'chip-button active' : 'chip-button'} disabled={busy === review.id}
                      onClick={() => update(review, { featured: !review.featured }, review.featured ? 'Review unpinned.' : 'Review pinned to the top of the reviews page and carousel.')}>
                      ★ {review.featured ? 'Featured' : 'Feature'}
                    </button>
                  )}
                  {review.status !== 'hidden' && (
                    <button type="button" className="ghost-button" disabled={busy === review.id}
                      onClick={() => update(review, { status: 'hidden' }, review.status === 'approved' ? 'Review removed from the website.' : 'Review hidden.')}>
                      <Icon name="eyeOff" size={14} />Hide
                    </button>
                  )}
                  <button type="button" className="icon-button danger" disabled={busy === review.id} onClick={() => setPendingDelete(review)} aria-label={`Delete review by ${review.name}`}><Icon name="trash" size={15} /></button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state">
            <span className="empty-icon"><Icon name="star" size={22} /></span>
            <p>{filter === 'pending' ? 'No reviews waiting. Share the link to collect more.' : filter === 'approved' ? 'No published reviews yet.' : 'No hidden reviews.'}</p>
          </div>
        )}
      </section>

      {pendingDelete && (
        <ConfirmDialog title="Delete this review?" confirmLabel="Delete review"
          body={<>The review by {pendingDelete.name} will be removed for good. To take it off the website but keep it, use Hide instead.</>}
          onConfirm={remove} onCancel={() => setPendingDelete(null)} />
      )}
    </div>
  );
}

function ShareCard({ notify, average, count }: { notify: Notify; average: number; count: number }) {
  const link = reviewLink();
  const [qr, setQr] = useState('');

  useEffect(() => {
    let cancelled = false;
    import('qrcode').then(QRCode => QRCode.toString(link, { type: 'svg', margin: 1, color: { dark: '#1a1814', light: '#ffffff' } }))
      .then(svg => { if (!cancelled) setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [link]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      notify('Review link copied. Paste it into WhatsApp, SMS or email.');
    } catch {
      notify(`Copy this link: ${link}`);
    }
  };

  const downloadQr = async () => {
    const QRCode = await import('qrcode');
    const url = await QRCode.toDataURL(link, { width: 1200, margin: 2, color: { dark: '#1a1814', light: '#ffffff' } });
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'mandarin-orchid-review-qr.png';
    anchor.click();
  };

  const message = `Thank you for staying at Mandarin Orchid Resort! We would love to hear about your stay. Please leave a short review here: ${link}`;

  return (
    <section className="panel share-card stagger" style={stagger(0)}>
      <div className="share-copy">
        <p className="eyebrow">COLLECT REVIEWS</p>
        <h2>Share the review link</h2>
        <p className="muted">Send this to guests after checkout, or print the QR code for reception. New reviews wait here for your approval before they appear on the website.</p>
        <div className="share-link">
          <code>{link}</code>
          <button type="button" className="primary-button small" onClick={copy}><Icon name="clipboard" size={14} />Copy link</button>
        </div>
        <div className="share-actions">
          <a className="ghost-button" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener"><Icon name="external" size={14} />Share on WhatsApp</a>
          <button type="button" className="ghost-button" onClick={downloadQr}><Icon name="download" size={14} />Download QR code</button>
        </div>
        {count > 0 && <p className="share-score"><span>{average.toFixed(1)}</span> average from {count} published review{count === 1 ? '' : 's'}</p>}
      </div>
      <div className="share-qr">
        {qr ? <img src={qr} alt={`QR code linking to ${link}`} /> : <span className="skeleton" />}
        <small>Scan to write a review</small>
      </div>
    </section>
  );
}
