import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from './client';
import { inr, mealForHour, meals, optionLabel, resortNow, sectionLabel, shortDate } from './format';
import { MenuPicker } from './MenuPicker';
import { InvoiceDraft, Menu, Notify, PickedLine, Tab, TabOrder, TabSummary } from './types';
import { ConfirmDialog, Icon, Modal, Segmented, Spinner, stagger } from './ui';

type TabList = { open: TabSummary[]; closed: TabSummary[] };
const roomShortcuts = ['Villa 1', 'Villa 2', 'Villa 3', 'Villa 4'];

/** Groups orders by bill section, keeping the order in which sections first appeared. */
function bySection(orders: TabOrder[]) {
  const groups: { section: string; orders: TabOrder[]; total: number }[] = [];
  for (const order of orders) {
    let group = groups.find(entry => entry.section === order.section);
    if (!group) groups.push(group = { section: order.section, orders: [], total: 0 });
    group.orders.push(order);
    group.total += order.quantity * order.unit_price;
  }
  return groups;
}

/** Builds the invoice for a tab, merging repeat orders of the same item within a section. */
export function draftFromTab(tab: Tab): InvoiceDraft {
  const lines: InvoiceDraft['lines'] = [];
  for (const group of bySection(tab.orders)) {
    for (const order of group.orders) {
      const description = optionLabel(order.name, order.option);
      const same = lines.find(line => line.section === group.section && line.description === description && line.unitPrice === order.unit_price);
      if (same) same.quantity += order.quantity;
      else lines.push({ description, quantity: order.quantity, unitPrice: order.unit_price, section: group.section });
    }
  }
  return {
    tabId: tab.id,
    guestName: tab.guest_name,
    guestEmail: tab.guest_email,
    stayStart: tab.check_in,
    stayEnd: resortNow().date,
    stayLabel: tab.label,
    lines,
  };
}

const ago = (iso: string | null) => {
  if (!iso) return 'No orders yet';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'Last order just now';
  if (minutes < 60) return `Last order ${minutes} min ago`;
  if (minutes < 1440) return `Last order ${Math.round(minutes / 60)} h ago`;
  return `Last order ${shortDate(iso)}`;
};

export function Tabs({ menu, notify, onCheckout }: { menu: Menu | null; notify: Notify; onCheckout: (draft: InvoiceDraft) => void }) {
  const [list, setList] = useState<TabList | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const [opening, setOpening] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busyOrder, setBusyOrder] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      setList(await api<TabList>('/api/admin/tabs'));
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not load tabs.', true);
    }
  }, [notify]);

  const loadTab = useCallback(async (id: string) => {
    try {
      setTab(await api<Tab>(`/api/admin/tabs/${id}`));
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not open this tab.', true);
      setSelectedId(null);
    }
  }, [notify]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => {
    setTab(null);
    if (selectedId) loadTab(selectedId);
  }, [selectedId, loadTab]);

  // Keep tabs fresh when several staff add orders from different phones.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden || adding || editing) return;
      loadList();
      if (selectedId) loadTab(selectedId);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [loadList, loadTab, selectedId, adding, editing]);

  const applyTab = (next: Tab) => {
    setTab(next);
    loadList();
  };

  const changeQuantity = async (order: TabOrder, quantity: number) => {
    if (!tab) return;
    setBusyOrder(order.id);
    try {
      applyTab(await api<Tab>(`/api/admin/tabs/${tab.id}/orders/${order.id}`, quantity === 0
        ? { method: 'DELETE' }
        : { method: 'PATCH', body: JSON.stringify({ quantity }) }));
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update the order.', true);
    } finally {
      setBusyOrder(null);
    }
  };

  const removeTab = async () => {
    if (!tab) return;
    try {
      await api(`/api/admin/tabs/${tab.id}`, { method: 'DELETE' });
      notify(`${tab.label}'s tab was deleted.`);
      setDeleting(false);
      setSelectedId(null);
      loadList();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not delete the tab.', true);
    }
  };

  const groups = tab ? bySection(tab.orders) : [];
  const tabTotal = groups.reduce((sum, group) => sum + group.total, 0);

  return (
    <div className={selectedId ? 'tabs-layout has-selection' : 'tabs-layout'}>
      <section className="panel tabs-list stagger" style={stagger(0)}>
        <div className="panel-heading">
          <div><p className="eyebrow">IN-HOUSE</p><h2>Open tabs</h2></div>
          <button type="button" className="primary-button small" onClick={() => setOpening(true)}><Icon name="plus" size={14} />Open tab</button>
        </div>
        {!list ? (
          <div className="table-skeleton">{[0, 1, 2].map(row => <span key={row} className="skeleton" />)}</div>
        ) : list.open.length ? (
          <ul className="tab-cards">
            {list.open.map((summary, index) => (
              <li key={summary.id} style={{ animationDelay: `${index * 40}ms` }}>
                <button type="button" className={selectedId === summary.id ? 'tab-card selected' : 'tab-card'} onClick={() => setSelectedId(summary.id)}>
                  <span className="tab-card-top"><b>{summary.label}</b><strong>{inr(summary.total)}</strong></span>
                  <span className="tab-card-meta">{summary.guest_name || 'Guest name not added'} · since {shortDate(summary.check_in)}</span>
                  <span className="tab-card-meta">{summary.order_count} item{summary.order_count === 1 ? '' : 's'} · {ago(summary.last_order_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state">
            <span className="empty-icon"><Icon name="clipboard" size={22} /></span>
            <p>No open tabs. Open one when guests check in, then add their orders as they happen.</p>
          </div>
        )}

        {list && list.closed.length > 0 && (
          <div className="closed-tabs">
            <p className="eyebrow">RECENTLY BILLED</p>
            <ul>
              {list.closed.map(summary => (
                <li key={summary.id}>
                  <span><b>{summary.label}</b> · {summary.guest_name || 'Guest'}<small>{summary.invoice_number} · {summary.closed_at ? shortDate(summary.closed_at) : ''}</small></span>
                  <strong>{inr(summary.total)}</strong>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="panel tab-detail stagger" style={stagger(1)}>
        {!selectedId ? (
          <div className="empty-state tall">
            <span className="empty-icon"><Icon name="utensils" size={22} /></span>
            <p>Select a tab to add orders, or open a new one.</p>
          </div>
        ) : !tab ? (
          <div className="table-skeleton">{[0, 1, 2, 3].map(row => <span key={row} className="skeleton" />)}</div>
        ) : (
          <>
            <button type="button" className="text-button back-to-list" onClick={() => setSelectedId(null)}><Icon name="arrowLeft" size={14} />All tabs</button>
            <div className="tab-header">
              <div>
                <p className="eyebrow">TAB · SINCE {shortDate(tab.check_in).toUpperCase()}</p>
                <h2>{tab.label}</h2>
                <p className="muted">{tab.guest_name || 'Guest name not added yet'}{tab.guest_email && ` · ${tab.guest_email}`}</p>
              </div>
              <div className="tab-total"><span>Running total</span><strong key={tabTotal} className="pulse">{inr(tabTotal)}</strong></div>
            </div>
            <div className="tab-actions">
              <button type="button" className="primary-button" onClick={() => setAdding(true)} disabled={!menu}><Icon name="plus" size={15} />Add orders</button>
              <button type="button" className="ghost-button" onClick={() => onCheckout(draftFromTab(tab))} disabled={!tab.orders.length}><Icon name="receipt" size={14} />Check out & bill</button>
              <button type="button" className="icon-button bordered" onClick={() => setEditing(true)} aria-label="Edit tab details"><Icon name="edit" size={15} /></button>
              <button type="button" className="icon-button bordered danger" onClick={() => setDeleting(true)} aria-label="Delete tab"><Icon name="trash" size={15} /></button>
            </div>

            {groups.length ? groups.map(group => (
              <div key={group.section} className="order-group">
                <div className="line-section"><span className="line-section-label">{group.section}</span><span className="line-section-total">{inr(group.total)}</span></div>
                <ul>
                  {group.orders.map(order => (
                    <li key={order.id} className={busyOrder === order.id ? 'busy' : ''}>
                      <span className="order-name">{optionLabel(order.name, order.option)}<small>{inr(order.unit_price)} each</small></span>
                      <span className="stepper">
                        <button type="button" disabled={busyOrder === order.id} onClick={() => changeQuantity(order, order.quantity - 1)} aria-label={`One less ${order.name}`}>
                          <Icon name={order.quantity === 1 ? 'trash' : 'minus'} size={13} />
                        </button>
                        <b>{order.quantity}</b>
                        <button type="button" disabled={busyOrder === order.id} onClick={() => changeQuantity(order, order.quantity + 1)} aria-label={`One more ${order.name}`}><Icon name="plus" size={13} /></button>
                      </span>
                      <span className="order-amount">{inr(order.quantity * order.unit_price)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )) : (
              <div className="empty-state">
                <span className="empty-icon"><Icon name="utensils" size={22} /></span>
                <p>No orders yet. Tap “Add orders” when the guests order something.</p>
              </div>
            )}
          </>
        )}
      </section>

      {opening && <OpenTabDialog notify={notify} onClose={() => setOpening(false)} onOpened={opened => { setOpening(false); loadList(); setSelectedId(opened.id); setAdding(true); }} />}
      {editing && tab && <EditTabDialog tab={tab} notify={notify} onClose={() => setEditing(false)} onSaved={saved => { setEditing(false); applyTab(saved); }} />}
      {adding && tab && menu && <AddOrdersDialog tab={tab} menu={menu} notify={notify} onClose={() => setAdding(false)} onAdded={saved => { setAdding(false); applyTab(saved); }} />}
      {deleting && tab && (
        <ConfirmDialog title={`Delete ${tab.label}'s tab?`} confirmLabel="Delete tab"
          body={tab.orders.length ? <>Its {tab.orders.length} orders ({inr(tabTotal)}) will be lost. Use “Check out & bill” instead if the guest should pay.</> : 'This tab has no orders.'}
          onConfirm={removeTab} onCancel={() => setDeleting(false)} />
      )}
    </div>
  );
}

function OpenTabDialog({ notify, onClose, onOpened }: { notify: Notify; onClose: () => void; onOpened: (tab: Tab) => void }) {
  const [label, setLabel] = useState('');
  const [guestName, setGuestName] = useState('');
  const [checkIn, setCheckIn] = useState(resortNow().date);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const tab = await api<Tab>('/api/admin/tabs', { method: 'POST', body: JSON.stringify({ label, guestName, checkIn }) });
      notify(`Tab opened for ${tab.label}.`);
      onOpened(tab);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not open the tab.', true);
      setBusy(false);
    }
  };

  return (
    <Modal title="Open a tab" onClose={onClose}>
      <form className="dialog-form" onSubmit={submit}>
        <h2>Open a tab</h2>
        <p className="muted">One tab per villa or room. Add orders to it during the stay and bill it at checkout.</p>
        <label>Villa or room<input value={label} onChange={event => setLabel(event.target.value)} maxLength={60} placeholder="e.g. Villa 1 or Room 12" required data-autofocus /></label>
        <div className="quick-add">
          {roomShortcuts.map(room => <button key={room} type="button" className={label === room ? 'chip-button active' : 'chip-button'} onClick={() => setLabel(room)}>{room}</button>)}
        </div>
        <label><span>Guest name <span className="optional">optional, can be added later</span></span><input value={guestName} onChange={event => setGuestName(event.target.value)} maxLength={140} autoComplete="off" /></label>
        <label>Check-in date<input type="date" value={checkIn} onChange={event => setCheckIn(event.target.value)} required /></label>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" disabled={busy || !label.trim()}>{busy ? <><Spinner /> Opening…</> : 'Open tab'}</button>
        </div>
      </form>
    </Modal>
  );
}

function EditTabDialog({ tab, notify, onClose, onSaved }: { tab: Tab; notify: Notify; onClose: () => void; onSaved: (tab: Tab) => void }) {
  const [label, setLabel] = useState(tab.label);
  const [guestName, setGuestName] = useState(tab.guest_name);
  const [guestEmail, setGuestEmail] = useState(tab.guest_email);
  const [checkIn, setCheckIn] = useState(tab.check_in);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      onSaved(await api<Tab>(`/api/admin/tabs/${tab.id}`, { method: 'PATCH', body: JSON.stringify({ label, guestName, guestEmail, checkIn }) }));
      notify('Tab details saved.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save the tab.', true);
      setBusy(false);
    }
  };

  return (
    <Modal title="Edit tab" onClose={onClose}>
      <form className="dialog-form" onSubmit={submit}>
        <h2>Tab details</h2>
        <label>Villa or room<input value={label} onChange={event => setLabel(event.target.value)} maxLength={60} required data-autofocus /></label>
        <label>Guest name<input value={guestName} onChange={event => setGuestName(event.target.value)} maxLength={140} autoComplete="off" /></label>
        <label><span>Guest email <span className="optional">optional</span></span><input type="email" value={guestEmail} onChange={event => setGuestEmail(event.target.value)} maxLength={254} autoComplete="off" /></label>
        <label>Check-in date<input type="date" value={checkIn} onChange={event => setCheckIn(event.target.value)} required /></label>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" disabled={busy || !label.trim()}>{busy ? <><Spinner /> Saving…</> : 'Save details'}</button>
        </div>
      </form>
    </Modal>
  );
}

function AddOrdersDialog({ tab, menu, notify, onClose, onAdded }: { tab: Tab; menu: Menu; notify: Notify; onClose: () => void; onAdded: (tab: Tab) => void }) {
  const now = resortNow();
  const [date, setDate] = useState(now.date);
  const [meal, setMeal] = useState<string>(mealForHour(now.hour));

  const save = async (lines: PickedLine[]) => {
    try {
      const saved = await api<Tab>(`/api/admin/tabs/${tab.id}/orders`, {
        method: 'POST',
        body: JSON.stringify({ orders: lines.map(line => ({ ...line, section: sectionLabel(date, meal) })) }),
      });
      notify(`Added ${lines.reduce((sum, line) => sum + line.quantity, 0)} items to ${tab.label}.`);
      onAdded(saved);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not add the orders.', true);
    }
  };

  return (
    <Modal title={`Add orders to ${tab.label}`} onClose={onClose} wide>
      <MenuPicker menu={menu} confirmLabel={`Add to ${tab.label}`} onConfirm={save} onCancel={onClose}
        header={(
          <div className="picker-header">
            <div>
              <p className="eyebrow">ADD ORDERS</p>
              <h2>{tab.label}</h2>
            </div>
            <div className="picker-when">
              <label><span className="visually-hidden">Order date</span><input type="date" value={date} max={now.date} onChange={event => setDate(event.target.value || now.date)} /></label>
              <Segmented label="Meal" value={meal} onChange={setMeal} options={meals.map(name => ({ id: name, label: name === 'Evening snacks' ? 'Snacks' : name }))} />
            </div>
          </div>
        )} />
    </Modal>
  );
}
