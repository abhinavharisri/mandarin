import { useCallback, useEffect, useRef, useState } from 'react';
import { Billing } from './Billing';
import { api, sessionRenewedEvent, unauthorizedEvent } from './client';
import { duration } from './format';
import { Gallery } from './Gallery';
import { Gate, GateMode } from './Gate';
import { Login } from './Login';
import { MenuPage } from './MenuPage';
import { Overview } from './Overview';
import { Reports } from './Reports';
import { Tabs } from './Tabs';
import { GalleryImage, InvoiceDraft, InvoiceSummary, Menu, Session, View } from './types';
import { Icon, Toast, Toasts } from './ui';
import logoUrl from './logo.png';

const views: { id: View; label: string; title: string; subtitle: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', title: 'Dashboard', subtitle: 'Revenue, photos and website at a glance', icon: 'overview' },
  { id: 'tabs', label: 'Tabs', title: 'Guest tabs', subtitle: 'Add orders for each villa and bill them at checkout', icon: 'clipboard' },
  { id: 'billing', label: 'Billing', title: 'Billing & invoices', subtitle: 'Create branded invoices and track history', icon: 'billing' },
  { id: 'menu', label: 'Menu', title: 'Food & beverages menu', subtitle: 'Prices and items used for orders and bills', icon: 'utensils' },
  { id: 'reports', label: 'Reports', title: 'Reports & exports', subtitle: 'Revenue, best sellers and accounting exports', icon: 'chart' },
  { id: 'gallery', label: 'Gallery', title: 'Photo gallery', subtitle: 'Publish and curate photos on the website', icon: 'gallery' },
];
const idleLimitMs = 30 * 60 * 1000;
/** While someone is actively using the dashboard, renew the session once it has under 25 minutes left. */
const renewBelowSeconds = 25 * 60;
const recentActivityMs = 2 * 60 * 1000;
const gateDurationMs = 1900;
const gateExitMs = 650;
const themeKey = 'mo-admin-theme-choice';
type Theme = 'light' | 'dark';
const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

const viewFromHash = (): View => {
  const id = window.location.hash.replace(/^#\/?/, '');
  return views.some(view => view.id === id) ? id as View : 'overview';
};

/** Light by default; dark only when the administrator has chosen it. */
function storedTheme(): Theme {
  try {
    if (localStorage.getItem(themeKey) === 'dark') return 'dark';
  } catch { /* storage unavailable */ }
  return 'light';
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [lockMessage, setLockMessage] = useState('');
  const [view, setView] = useState<View>(viewFromHash);
  const [gallery, setGallery] = useState<GalleryImage[]>([]);
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const [now, setNow] = useState(() => Date.now());
  const [gate, setGate] = useState<{ mode: GateMode; leaving: boolean } | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const lastActivity = useRef(Date.now());
  const toastId = useRef(0);

  const notify = useCallback((text: string, isError = false) => {
    const id = ++toastId.current;
    setToasts(current => [...current.slice(-3), { id, text, isError }]);
    window.setTimeout(() => setToasts(current => current.filter(toast => toast.id !== id)), isError ? 7000 : 4200);
  }, []);

  const lock = useCallback((message: string) => {
    setSession({ authenticated: false, expiresAt: null });
    setLockMessage(message);
    setGallery([]);
    setInvoices([]);
    setMenu(null);
    setDraft(null);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem(themeKey, next); } catch { /* storage unavailable */ }
  };

  /** Plays the branded transition while `work` runs, then fades it away. */
  const runGate = async (mode: GateMode, work: Promise<unknown>, onDone: () => void) => {
    setGate({ mode, leaving: false });
    await Promise.allSettled([work, wait(gateDurationMs)]);
    onDone();
    setGate({ mode, leaving: true });
    await wait(gateExitMs);
    setGate(null);
  };

  useEffect(() => {
    api<Session>('/api/admin/session')
      .then(setSession)
      .catch(error => {
        setSession({ authenticated: false, expiresAt: null });
        setLockMessage(error instanceof Error ? error.message : 'Could not check the admin session.');
      });
    const onUnauthorized = () => lock('Your session has ended. Please sign in again.');
    const onHash = () => setView(viewFromHash());
    window.addEventListener(unauthorizedEvent, onUnauthorized);
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener(unauthorizedEvent, onUnauthorized);
      window.removeEventListener('hashchange', onHash);
    };
  }, [lock]);

  const refresh = useCallback(async () => {
    const [images, recentInvoices] = await Promise.all([
      api<GalleryImage[]>('/api/admin/gallery'),
      api<InvoiceSummary[]>('/api/admin/invoices'),
    ]);
    setGallery(images);
    setInvoices(recentInvoices);
  }, []);

  const authenticated = Boolean(session?.authenticated);

  useEffect(() => {
    if (!authenticated) return;
    setDataLoading(true);
    refresh()
      .catch(error => notify(error instanceof Error ? error.message : 'Could not load admin data.', true))
      .finally(() => setDataLoading(false));
    api<Menu>('/api/admin/menu').then(setMenu)
      .catch(error => notify(error instanceof Error ? error.message : 'Could not load the menu.', true));
  }, [authenticated, refresh, notify]);

  // Session countdown, expiry, keep-alive while active, and idle auto-lock.
  const expiresAt = useRef<number | null>(null);
  expiresAt.current = session?.expiresAt ?? null;

  useEffect(() => {
    const onRenewed = (event: Event) => {
      const next = (event as CustomEvent<number>).detail;
      setSession(current => current?.authenticated ? { ...current, expiresAt: next } : current);
    };
    window.addEventListener(sessionRenewedEvent, onRenewed);
    return () => window.removeEventListener(sessionRenewedEvent, onRenewed);
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    lastActivity.current = Date.now();
    let renewing = false;
    const markActive = () => { lastActivity.current = Date.now(); };
    const activityEvents = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    activityEvents.forEach(name => window.addEventListener(name, markActive, { passive: true }));
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      const secondsLeft = expiresAt.current ? expiresAt.current - current / 1000 : Infinity;
      if (secondsLeft <= 0) {
        lock('Your secure session ended. Please sign in again.');
      } else if (current - lastActivity.current > idleLimitMs) {
        api('/api/admin/logout', { method: 'POST' }).catch(() => {});
        lock('Locked after 30 minutes of inactivity.');
      } else if (!renewing && secondsLeft < renewBelowSeconds && current - lastActivity.current < recentActivityMs) {
        // Someone is reading or typing without saving anything: keep their session alive.
        renewing = true;
        api<Session>('/api/admin/session')
          .then(next => { if (!next.authenticated) lock('Your session has ended. Please sign in again.'); })
          .catch(() => {})
          .finally(() => { renewing = false; });
      }
    }, 15_000);
    return () => {
      window.clearInterval(timer);
      activityEvents.forEach(name => window.removeEventListener(name, markActive));
    };
  }, [authenticated, lock]);

  const navigate = (next: View) => {
    if (next === view) return;
    window.location.hash = `/${next}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const signOut = () => {
    if (gate) return;
    let failed = false;
    const logout = api('/api/admin/logout', { method: 'POST' }).catch(error => {
      failed = true;
      notify(error instanceof Error ? error.message : 'Could not sign out.', true);
    });
    runGate('out', logout, () => { if (!failed) lock('You have signed out securely.'); });
  };

  const signedIn = (next: Session) => {
    setLockMessage('');
    setSession(next);
    runGate('in', Promise.resolve(), () => {});
  };

  const gateOverlay = gate && <Gate mode={gate.mode} leaving={gate.leaving} />;

  if (!session) {
    return <main className="boot-screen" aria-busy="true"><img src={logoUrl} alt="" /><p>Opening your dashboard…</p></main>;
  }
  if (!session.authenticated) {
    return <>{gateOverlay}<Login message={lockMessage} onSignedIn={signedIn} /></>;
  }
  // Hold the dashboard back until the sign-in transition starts to fade, so its entrance animations play on reveal.
  if (gate?.mode === 'in' && !gate.leaving) return gateOverlay;

  const current = views.find(item => item.id === view)!;
  const remaining = session.expiresAt ? session.expiresAt - Math.floor(now / 1000) : null;

  return (
    <div className="dashboard">
      <a className="skip-link" href="#main">Skip to content</a>
      <aside className="sidebar">
        <a className="sidebar-brand" href="/" target="_blank" rel="noopener" title="Open the resort website">
          <img src={logoUrl} alt="" />
          <span><b>Mandarin Orchid</b><small>RESORT ADMIN</small></span>
        </a>
        <nav aria-label="Dashboard">
          <p className="nav-heading">MANAGE</p>
          {views.map(item => (
            <button key={item.id} type="button" className={view === item.id ? 'nav-item selected' : 'nav-item'}
              aria-current={view === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>
              <Icon name={item.icon} size={18} /><span>{item.label}</span>
            </button>
          ))}
          <p className="nav-heading">WEBSITE</p>
          <a className="nav-item" href="/" target="_blank" rel="noopener"><Icon name="globe" size={18} /><span>View website</span><Icon name="external" size={13} /></a>
          <a className="nav-item" href="/gallery" target="_blank" rel="noopener"><Icon name="gallery" size={18} /><span>Public gallery</span><Icon name="external" size={13} /></a>
        </nav>
        <div className="sidebar-footer">
          <div className="session-card">
            <Icon name="shield" size={16} />
            <div><b>Secure session</b><small>{remaining !== null ? `Locks in ${duration(remaining)} if idle` : 'Active'} · stays open while you work</small></div>
          </div>
          <button type="button" className="signout" onClick={signOut}><Icon name="logout" size={16} />Sign out</button>
        </div>
      </aside>

      <div className="dashboard-main">
        <header className="topbar">
          <div className="topbar-title">
            <a className="mobile-brand" href="/" target="_blank" rel="noopener" aria-label="Open the resort website"><img src={logoUrl} alt="" /></a>
            <div>
              <h1>{current.title}</h1>
              <p className="muted">{current.subtitle}</p>
            </div>
          </div>
          <div className="topbar-actions">
            <button type="button" className="icon-button bordered" onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
            </button>
            <a className="ghost-button hide-mobile" href="/" target="_blank" rel="noopener"><Icon name="globe" size={15} />View website</a>
            <button type="button" className="icon-button bordered show-mobile" onClick={signOut} aria-label="Sign out"><Icon name="logout" size={17} /></button>
          </div>
        </header>

        <main id="main" className="dashboard-content" key={view}>
          {view === 'overview' && <Overview gallery={gallery} invoices={invoices} loading={dataLoading} onNavigate={navigate} />}
          {view === 'tabs' && <Tabs menu={menu} notify={notify} onCheckout={next => { setDraft(next); navigate('billing'); }} />}
          {view === 'billing' && <Billing invoices={invoices} loading={dataLoading} refresh={refresh} notify={notify}
            menu={menu} draft={draft} onDraftUsed={() => setDraft(null)} />}
          {view === 'menu' && <MenuPage menu={menu} onSaved={setMenu} notify={notify} />}
          {view === 'reports' && <Reports notify={notify} />}
          {view === 'gallery' && <Gallery images={gallery} loading={dataLoading} refresh={refresh} notify={notify} />}
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Dashboard sections">
        {views.map(item => (
          <button key={item.id} type="button" className={view === item.id ? 'selected' : ''} aria-current={view === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>
            <Icon name={item.icon} size={20} /><span>{item.label}</span>
          </button>
        ))}
      </nav>

      {gateOverlay}
      <Toasts toasts={toasts} dismiss={id => setToasts(current => current.filter(toast => toast.id !== id))} />
    </div>
  );
}
