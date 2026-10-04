import { Icon } from './ui';
import logoUrl from './logo.png';

export type GateMode = 'in' | 'out';

const copy: Record<GateMode, { title: string; detail: string; steps: string[] }> = {
  in: {
    title: 'Unlocking your dashboard',
    detail: 'Verifying your secure session',
    steps: ['Session verified', 'Loading gallery', 'Preparing invoices'],
  },
  out: {
    title: 'Signing you out',
    detail: 'Closing your secure session',
    steps: ['Ending session', 'Clearing dashboard', 'All secure'],
  },
};

/** Full-screen branded transition shown while signing in and out. */
export function Gate({ mode, leaving }: { mode: GateMode; leaving: boolean }) {
  const text = copy[mode];
  return (
    <div className={`gate gate-${mode}${leaving ? ' leaving' : ''}`} role="status" aria-live="assertive">
      <div className="gate-glow" aria-hidden="true" />
      <div className="gate-inner">
        <div className="gate-emblem" aria-hidden="true">
          <svg viewBox="0 0 120 120" className="gate-ring">
            <circle cx="60" cy="60" r="54" className="gate-ring-track" />
            <circle cx="60" cy="60" r="54" className="gate-ring-draw" />
          </svg>
          <svg viewBox="0 0 120 120" className="gate-orbit"><circle cx="60" cy="60" r="58" /></svg>
          <img src={logoUrl} alt="" />
          <span className="gate-lock"><Icon name={mode === 'in' ? 'lock' : 'shield'} size={14} /></span>
        </div>
        <p className="eyebrow">MANDARIN ORCHID RESORT</p>
        <h2>{text.title}<span className="gate-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></h2>
        <p className="gate-detail">{text.detail}</p>
        <ul className="gate-steps" aria-hidden="true">
          {text.steps.map((step, index) => (
            <li key={step} style={{ animationDelay: `${250 + index * 330}ms` }}><Icon name="check" size={12} />{step}</li>
          ))}
        </ul>
        <div className="gate-progress" aria-hidden="true"><span /></div>
      </div>
    </div>
  );
}
