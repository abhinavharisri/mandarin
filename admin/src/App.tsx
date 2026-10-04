import { useCallback, useEffect, useRef, useState } from 'react';
import { Billing } from './Billing';
import { api, unauthorizedEvent } from './client';
import { duration } from './format';
import { Gallery } from './Gallery';
import { Gate, GateMode } from './Gate';
import { Login } from './Login';
import { Overview } from './Overview';
import { GalleryImage, InvoiceSummary, Session, View } from './types';
import { Icon, Toast, Toasts } from './ui';

const views: { id: View; label: string; title: string; subtitle: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', title: 'Dashboard', subtitle: 'Revenue, photos and website at a glance', icon: 'overview' },
  { id: 'gallery', label: 'Gallery', title: 'Photo gallery', subtitle: 'Publish and curate photos on the website', icon: 'gallery' },
  { id: 'billing', label: 'Billing', title: 'Billing & invoices', subtitle: 'Create branded invoices and track history', icon: 'billing' },
];
const idleLimitMs = 30 * 60 * 1000;
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
  }, [authenticated, refresh, notify]);

  // Session countdown, expiry and idle auto-lock.
  useEffect(() => {
    if (!authenticated) return;
    lastActivity.current = Date.now();
    const markActive = () => { lastActivity.current = Date.now(); };
    const activityEvents = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    activityEvents.forEach(name => window.addEventListener(name, markActive, { passive: true }));
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (session?.expiresAt && current / 1000 >= session.expiresAt) {
        lock('Your secure session expired. Please sign in again.');
      } else if (current - lastActivity.current > idleLimitMs) {
        api('/api/admin/logout', { method: 'POST' }).catch(() => {});
        lock('Locked after 30 minutes of inactivity.');
      }
    }, 15_000);
    return () => {
      window.clearInterval(timer);
      activityEvents.forEach(name => window.removeEventListener(name, markActive));
    };
  }, [authenticated, session?.expiresAt, lock]);

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
    return <main className="boot-screen" aria-busy="true"><img src="/admin/favicon.png" alt="" /><p>Opening your dashboard…</p></main>;
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
          <img src="/admin/favicon.png" alt="" />
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
            <div><b>Secure session</b><small>{remaining !== null ? `Expires in ${duration(remaining)}` : 'Active'} · auto-locks when idle</small></div>
          </div>
          <button type="button" className="signout" onClick={signOut}><Icon name="logout" size={16} />Sign out</button>
        </div>
      </aside>

      <div className="dashboard-main">
        <header className="topbar">
          <div className="topbar-title">
            <a className="mobile-brand" href="/" target="_blank" rel="noopener" aria-label="Open the resort website"><img src="/admin/favicon.png" alt="" /></a>
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
          {view === 'gallery' && <Gallery images={gallery} loading={dataLoading} refresh={refresh} notify={notify} />}
          {view === 'billing' && <Billing invoices={invoices} loading={dataLoading} refresh={refresh} notify={notify} />}
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Dashboard sections">
        {views.map(item => (
          <button key={item.id} type="button" className={view === item.id ? 'selected' : ''} aria-current={view === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>
            <Icon name={item.icon} size={20} /><span>{item.label}</span>
          </button>
        ))}
        <a href="/" target="_blank" rel="noopener"><Icon name="globe" size={20} /><span>Website</span></a>
      </nav>

      {gateOverlay}
      <Toasts toasts={toasts} dismiss={id => setToasts(current => current.filter(toast => toast.id !== id))} />
    </div>
  );
}
