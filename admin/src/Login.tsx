import { FormEvent, KeyboardEvent, useState } from 'react';
import { api } from './client';
import { Session } from './types';
import { Icon, Spinner } from './ui';
import logoUrl from './logo.png';

export function Login({ onSignedIn, message }: { onSignedIn: (session: Session) => void; message?: string }) {
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const session = await api<Session>('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
      setPassword('');
      onSignedIn(session);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Sign-in failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const trackCapsLock = (event: KeyboardEvent<HTMLInputElement>) => setCapsLock(event.getModifierState?.('CapsLock') ?? false);

  return (
    <main className="auth-page">
      <section className="auth-visual" aria-hidden="true">
        <img src="/images/optimized/mistandmornings-1600.webp" alt="" />
        <div className="auth-visual-copy">
          <p className="eyebrow light">KOTAGIRI · THE NILGIRIS</p>
          <p className="auth-quote">“A quiet luxury retreat, cared for by the people who know it best.”</p>
        </div>
      </section>
      <section className="auth-panel">
        <a className="back-link" href="/"><Icon name="arrowRight" size={14} /> Back to resort website</a>
        <div className="auth-card">
          <img className="brand-mark" src={logoUrl} alt="" />
          <p className="eyebrow">MANDARIN ORCHID RESORT</p>
          <h1>Welcome back</h1>
          <p className="muted">Sign in to manage your gallery, invoices and revenue.</p>
          {message && <p className="inline-notice" role="status"><Icon name="lock" size={14} />{message}</p>}
          <form onSubmit={signIn} noValidate={false}>
            <label htmlFor="password">Administrator password</label>
            <div className="password-field">
              <Icon name="lock" size={16} />
              <input id="password" autoComplete="current-password" type={visible ? 'text' : 'password'} value={password}
                onChange={event => setPassword(event.target.value)} onKeyUp={trackCapsLock} onKeyDown={trackCapsLock}
                required autoFocus aria-invalid={Boolean(error)} aria-describedby={error ? 'login-error' : undefined} />
              <button type="button" className="icon-button" onClick={() => setVisible(!visible)}
                aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}>
                <Icon name={visible ? 'eyeOff' : 'eye'} size={16} />
              </button>
            </div>
            {capsLock && <p className="field-hint warn">Caps Lock is on</p>}
            {error && <p className="field-error" id="login-error" role="alert"><Icon name="alert" size={14} />{error}</p>}
            <button className="primary-button wide" disabled={busy || !password}>
              {busy ? <><Spinner /> Verifying…</> : <>Sign in securely <Icon name="arrowRight" size={15} /></>}
            </button>
          </form>
          <ul className="trust-list">
            <li><Icon name="shield" size={14} /> Encrypted, HttpOnly session</li>
            <li><Icon name="lock" size={14} /> Auto-locks when idle</li>
          </ul>
        </div>
      </section>
    </main>
  );
}
