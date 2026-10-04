import { FormEvent, ReactNode, useMemo, useState } from 'react';
import { inr } from './format';
import { Menu, MenuItem, MenuOption, PickedLine } from './types';
import { Icon, Spinner } from './ui';

type CartLine = PickedLine & { key: string };

export function DietDot({ diet }: { diet: MenuItem['diet'] }) {
  const label = diet === 'veg' ? 'Vegetarian' : diet === 'egg' ? 'Contains egg' : 'Non-vegetarian';
  return <span className={`diet-dot ${diet}`} role="img" aria-label={label} title={label} />;
}

const optionText = (option: MenuOption) =>
  option.price === null ? `${option.label ? `${option.label} · ` : ''}Enter price` : `${option.label ? `${option.label} ` : ''}${inr(option.price).replace('.00', '')}`;

/**
 * Tap-to-add menu with a cart. Used for tab orders and invoice lines.
 * Unavailable items are hidden; "as per availability" items ask for a price.
 */
export function MenuPicker({ menu, header, confirmLabel, onConfirm, onCancel }: {
  menu: Menu;
  header?: ReactNode;
  confirmLabel: string;
  onConfirm: (lines: PickedLine[]) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [pricing, setPricing] = useState<{ item: MenuItem; option: MenuOption; price: string } | null>(null);
  const [custom, setCustom] = useState<{ name: string; price: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const available = menu.items.filter(item => item.available);
  const categories = useMemo(() => [...new Set(available.map(item => item.category))], [available]);
  const term = query.trim().toLowerCase();
  const visible = available.filter(item =>
    (category === 'All' || item.category === category) && (!term || `${item.name} ${item.category}`.toLowerCase().includes(term)));
  const groups = categories.map(name => ({ name, items: visible.filter(item => item.category === name) })).filter(group => group.items.length);

  const countFor = (item: MenuItem, option: MenuOption) =>
    cart.filter(line => line.itemId === item.id && line.option === option.label).reduce((sum, line) => sum + line.quantity, 0);

  const addLine = (line: PickedLine) => setCart(current => {
    const key = `${line.itemId || line.name}|${line.option}|${line.unitPrice}`;
    const existing = current.find(entry => entry.key === key);
    return existing
      ? current.map(entry => entry.key === key ? { ...entry, quantity: Math.min(999, entry.quantity + line.quantity) } : entry)
      : [...current, { ...line, key }];
  });

  const pick = (item: MenuItem, option: MenuOption) => {
    if (option.price === null) {
      setPricing({ item, option, price: '' });
      return;
    }
    addLine({ itemId: item.id, name: item.name, option: option.label, quantity: 1, unitPrice: option.price });
  };

  const confirmPrice = (event: FormEvent) => {
    event.preventDefault();
    if (!pricing || !(Number(pricing.price) > 0)) return;
    addLine({ itemId: pricing.item.id, name: pricing.item.name, option: pricing.option.label, quantity: 1, unitPrice: Number(pricing.price) });
    setPricing(null);
  };

  const addCustom = (event: FormEvent) => {
    event.preventDefault();
    if (!custom || !custom.name.trim() || !(Number(custom.price) >= 0) || custom.price === '') return;
    addLine({ itemId: null, name: custom.name.trim(), option: '', quantity: 1, unitPrice: Number(custom.price) });
    setCustom(null);
  };

  const step = (key: string, delta: number) =>
    setCart(current => current.map(line => line.key === key ? { ...line, quantity: line.quantity + delta } : line).filter(line => line.quantity > 0));

  const count = cart.reduce((sum, line) => sum + line.quantity, 0);
  const total = cart.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm(cart.map(({ key: _key, ...line }) => line));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="picker">
      <div className="picker-top">
        {header}
        <label className="search-field">
          <span className="visually-hidden">Search the menu</span>
          <Icon name="search" size={15} />
          <input type="search" placeholder="Search the menu… e.g. dosai, biryani, tea" value={query} onChange={event => setQuery(event.target.value)} />
        </label>
        <div className="chip-scroll" role="tablist" aria-label="Menu categories">
          {['All', ...categories].map(name => (
            <button key={name} type="button" role="tab" aria-selected={category === name} className={category === name ? 'chip active' : 'chip'} onClick={() => setCategory(name)}>{name}</button>
          ))}
        </div>
      </div>

      <div className="picker-list">
        {groups.map(group => (
          <section key={group.name}>
            {(category === 'All' || term) && <h4>{group.name}</h4>}
            {group.items.map(item => (
              <div key={item.id} className="picker-item">
                <div className="picker-item-row">
                  <DietDot diet={item.diet} />
                  <span className="picker-item-name">{item.name}</span>
                  <div className="picker-options">
                    {item.options.map(option => {
                      const inCart = countFor(item, option);
                      return (
                        <button key={option.label} type="button" className={inCart ? 'add-option in-cart' : 'add-option'} onClick={() => pick(item, option)}
                          aria-label={`Add ${item.name}${option.label ? ` ${option.label}` : ''}`}>
                          {inCart ? <span className="add-count">{inCart}</span> : <Icon name="plus" size={12} />}{optionText(option)}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {pricing?.item.id === item.id && (
                  <form className="inline-price" onSubmit={confirmPrice}>
                    <label><span className="visually-hidden">Price for {item.name}</span>
                      <input type="number" inputMode="decimal" min="1" step="0.01" placeholder="Today's price (₹)" value={pricing.price} autoFocus
                        onChange={event => setPricing({ ...pricing, price: event.target.value })} />
                    </label>
                    <button className="primary-button small" disabled={!(Number(pricing.price) > 0)}>Add</button>
                    <button type="button" className="icon-button" onClick={() => setPricing(null)} aria-label="Cancel"><Icon name="close" size={14} /></button>
                  </form>
                )}
              </div>
            ))}
          </section>
        ))}
        {!groups.length && <p className="empty-state">Nothing on the menu matches “{query}”.</p>}

        {custom ? (
          <form className="custom-item" onSubmit={addCustom}>
            <label>Item<input value={custom.name} maxLength={100} placeholder="e.g. Balance rent, Extra bed" autoFocus onChange={event => setCustom({ ...custom, name: event.target.value })} /></label>
            <label>Price (₹)<input type="number" inputMode="decimal" min="0" step="0.01" value={custom.price} onChange={event => setCustom({ ...custom, price: event.target.value })} /></label>
            <button className="primary-button small" disabled={!custom.name.trim() || custom.price === ''}>Add</button>
            <button type="button" className="icon-button" onClick={() => setCustom(null)} aria-label="Cancel custom item"><Icon name="close" size={14} /></button>
          </form>
        ) : (
          <button type="button" className="text-button custom-trigger" onClick={() => setCustom({ name: query, price: '' })}>
            <Icon name="plus" size={14} />Not on the menu? Add a custom item
          </button>
        )}
      </div>

      <div className={cart.length ? 'picker-cart open' : 'picker-cart'}>
        {cart.length > 0 && (
          <ul>
            {cart.map(line => (
              <li key={line.key}>
                <span className="cart-name">{line.name}{line.option && <small> · {line.option}</small>}</span>
                <span className="stepper">
                  <button type="button" onClick={() => step(line.key, -1)} aria-label={`One less ${line.name}`}><Icon name="minus" size={13} /></button>
                  <b>{line.quantity}</b>
                  <button type="button" onClick={() => step(line.key, 1)} aria-label={`One more ${line.name}`}><Icon name="plus" size={13} /></button>
                </span>
                <span className="cart-amount">{inr(line.quantity * line.unitPrice)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="picker-actions">
          <button type="button" className="ghost-button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="primary-button" disabled={!count || busy} onClick={confirm}>
            {busy ? <><Spinner /> Saving…</> : count ? `${confirmLabel} · ${count} item${count === 1 ? '' : 's'} · ${inr(total)}` : 'Tap items to add them'}
          </button>
        </div>
      </div>
    </div>
  );
}
