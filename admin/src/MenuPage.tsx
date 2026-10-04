import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from './client';
import { shortDate } from './format';
import { DietDot } from './MenuPicker';
import { Diet, Menu, MenuItem, Notify } from './types';
import { Icon, Spinner, stagger } from './ui';

const nextDiet: Record<Diet, Diet> = { veg: 'nonveg', nonveg: 'egg', egg: 'veg' };
const dietName: Record<Diet, string> = { veg: 'Veg', nonveg: 'Non-veg', egg: 'Egg' };
const newId = () => `item-${crypto.randomUUID().slice(0, 8)}`;

export function MenuPage({ menu, onSaved, notify }: { menu: Menu | null; onSaved: (menu: Menu) => void; notify: Notify }) {
  const [draft, setDraft] = useState<MenuItem[]>(menu?.items || []);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [newCategory, setNewCategory] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (menu) setDraft(menu.items); }, [menu]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(menu?.items || []), [draft, menu]);
  const categories = [...new Set(draft.map(item => item.category))];
  const term = query.trim().toLowerCase();
  const visible = (name: string) => draft.filter(item => item.category === name && (!term || item.name.toLowerCase().includes(term)));

  // Warn before leaving with unsaved price changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const update = (id: string, patch: Partial<MenuItem>) => setDraft(items => items.map(item => item.id === id ? { ...item, ...patch } : item));
  const updateOption = (item: MenuItem, index: number, patch: { label?: string; price?: number | null }) =>
    update(item.id, { options: item.options.map((option, i) => i === index ? { ...option, ...patch } : option) });

  const addItem = (categoryName: string) => {
    const lastIndex = draft.map(item => item.category).lastIndexOf(categoryName);
    const item: MenuItem = { id: newId(), name: '', category: categoryName, diet: 'veg', options: [{ label: '', price: 0 }], available: true };
    setDraft(items => [...items.slice(0, lastIndex + 1), item, ...items.slice(lastIndex + 1)]);
    window.setTimeout(() => document.getElementById(`menu-name-${item.id}`)?.focus(), 50);
  };

  const createCategory = (event: FormEvent) => {
    event.preventDefault();
    const name = newCategory?.trim();
    if (!name) return;
    if (categories.some(existing => existing.toLowerCase() === name.toLowerCase())) {
      notify('That category already exists.', true);
      return;
    }
    setNewCategory(null);
    setCategory('All');
    const item: MenuItem = { id: newId(), name: '', category: name, diet: 'veg', options: [{ label: '', price: 0 }], available: true };
    setDraft(items => [...items, item]);
    window.setTimeout(() => document.getElementById(`menu-name-${item.id}`)?.focus(), 50);
  };

  const save = async () => {
    const unnamed = draft.find(item => !item.name.trim());
    if (unnamed) {
      notify(`Give every item a name before saving (one is empty in ${unnamed.category}).`, true);
      document.getElementById(`menu-name-${unnamed.id}`)?.focus();
      return;
    }
    setSaving(true);
    try {
      const saved = await api<Menu>('/api/admin/menu', { method: 'PUT', body: JSON.stringify({ items: draft }) });
      onSaved(saved);
      notify('Menu saved. New orders and bills use these prices.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save the menu.', true);
    } finally {
      setSaving(false);
    }
  };

  if (!menu) return <section className="panel"><div className="table-skeleton">{[0, 1, 2, 3].map(row => <span key={row} className="skeleton" />)}</div></section>;

  const shown = (category === 'All' ? categories : [category]).filter(name => visible(name).length || (!term && name === category));

  return (
    <div className="view-stack menu-page">
      <section className="panel stagger" style={stagger(0)}>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">FOOD & BEVERAGES</p>
            <h2>{draft.length} menu items</h2>
          </div>
          <span className="muted small">{menu.updated_at ? `Last saved ${shortDate(menu.updated_at)}` : 'Prices from the printed menu'}</span>
        </div>
        <p className="muted small menu-help">
          Tap the coloured dot to switch veg / non-veg / egg. Leave a price empty for “as per availability” (asked when ordering). Turn an item off to hide it when taking orders.
        </p>
        <div className="toolbar">
          <label className="search-field">
            <span className="visually-hidden">Search menu items</span>
            <Icon name="search" size={15} />
            <input type="search" placeholder="Search items…" value={query} onChange={event => setQuery(event.target.value)} />
          </label>
          {newCategory === null ? (
            <button type="button" className="ghost-button" onClick={() => setNewCategory('')}><Icon name="plus" size={14} />New category</button>
          ) : (
            <form className="inline-price" onSubmit={createCategory}>
              <label><span className="visually-hidden">Category name</span><input value={newCategory} maxLength={40} placeholder="Category name" autoFocus onChange={event => setNewCategory(event.target.value)} /></label>
              <button className="primary-button small" disabled={!newCategory.trim()}>Add</button>
              <button type="button" className="icon-button" onClick={() => setNewCategory(null)} aria-label="Cancel"><Icon name="close" size={14} /></button>
            </form>
          )}
        </div>
        <div className="chip-scroll" role="tablist" aria-label="Menu categories">
          {['All', ...categories].map(name => (
            <button key={name} type="button" role="tab" aria-selected={category === name} className={category === name ? 'chip active' : 'chip'} onClick={() => setCategory(name)}>
              {name}{name !== 'All' && <span className="count">{draft.filter(item => item.category === name).length}</span>}
            </button>
          ))}
        </div>
      </section>

      {shown.map((name, index) => (
        <section key={name} className="panel menu-category stagger" style={stagger(Math.min(index + 1, 8))}>
          <div className="menu-category-heading">
            <h3>{name}</h3>
            <button type="button" className="text-button" onClick={() => addItem(name)}><Icon name="plus" size={14} />Add item</button>
          </div>
          <ul className="menu-rows">
            {visible(name).map(item => (
              <li key={item.id} className={item.available ? 'menu-row' : 'menu-row off'}>
                <button type="button" className="diet-toggle" onClick={() => update(item.id, { diet: nextDiet[item.diet] })}
                  aria-label={`${dietName[item.diet]}. Change to ${dietName[nextDiet[item.diet]]}`} title={`${dietName[item.diet]} (tap to change)`}>
                  <DietDot diet={item.diet} />
                </button>
                <label className="menu-name">
                  <span className="visually-hidden">Item name</span>
                  <input id={`menu-name-${item.id}`} value={item.name} maxLength={80} placeholder="Item name" onChange={event => update(item.id, { name: event.target.value })} />
                </label>
                <div className="menu-prices">
                  {item.options.map((option, optionIndex) => (
                    <div key={optionIndex} className="menu-price">
                      {item.options.length > 1 && (
                        <input className="option-label" value={option.label} maxLength={20} placeholder="Size" aria-label={`Size name for ${item.name}`}
                          onChange={event => updateOption(item, optionIndex, { label: event.target.value })} />
                      )}
                      <span className="rupee">₹</span>
                      <input type="number" inputMode="decimal" min="0" step="0.01" value={option.price ?? ''} placeholder="Market"
                        aria-label={`Price for ${item.name}${option.label ? ` ${option.label}` : ''}`}
                        onChange={event => updateOption(item, optionIndex, { price: event.target.value === '' ? null : Number(event.target.value) })} />
                      {item.options.length > 1 && (
                        <button type="button" className="icon-button" aria-label="Remove this size"
                          onClick={() => update(item.id, { options: item.options.filter((_, i) => i !== optionIndex) })}><Icon name="close" size={12} /></button>
                      )}
                    </div>
                  ))}
                  {item.options.length < 4 && (
                    <button type="button" className="text-button add-size" onClick={() => update(item.id, {
                      options: [...item.options.map((option, i) => i === 0 && !option.label ? { ...option, label: 'Plate' } : option), { label: item.options.length === 1 ? '1 kg' : '', price: null }],
                    })}><Icon name="plus" size={12} />Size</button>
                  )}
                </div>
                <label className="switch" title={item.available ? 'Available' : 'Hidden when taking orders'}>
                  <input type="checkbox" checked={item.available} onChange={event => update(item.id, { available: event.target.checked })} />
                  <span aria-hidden="true" /><span className="visually-hidden">Available</span>
                </label>
                <button type="button" className="icon-button danger" aria-label={`Delete ${item.name || 'item'}`}
                  onClick={() => setDraft(items => items.filter(entry => entry.id !== item.id))}><Icon name="trash" size={15} /></button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <div className={dirty ? 'save-bar visible' : 'save-bar'} aria-hidden={!dirty}>
        <span>Unsaved menu changes</span>
        <button type="button" className="ghost-button" onClick={() => setDraft(menu.items)} disabled={saving} tabIndex={dirty ? 0 : -1}>Discard</button>
        <button type="button" className="primary-button" onClick={save} disabled={saving} tabIndex={dirty ? 0 : -1}>{saving ? <><Spinner /> Saving…</> : 'Save menu'}</button>
      </div>
    </div>
  );
}
