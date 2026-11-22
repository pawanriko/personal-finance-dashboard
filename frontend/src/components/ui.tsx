import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { IconClose } from './icons';

/** Count-up number: animates from 0 (or the previous value) to `value`
 *  over 500ms (skill B7 base duration) with the base ease-out curve.
 *  Renders the final value immediately when the user prefers reduced
 *  motion. */
export function CountUp({
  value,
  format,
  duration = 500,
}: {
  value: number;
  format: (n: number) => string;
  duration?: number;
}) {
  const [shown, setShown] = useState(0);
  const prev = useRef(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      prev.current = value;
      return;
    }
    const from = prev.current;
    const start = performance.now();
    let raf = 0;
    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(from + (value - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else prev.current = value;
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <span className="tabular-nums">{format(shown)}</span>;
}

/** Animated SVG progress ring. The arc draws itself via a CSS
 *  transition on stroke-dashoffset; the percent sits in the middle. */
export function ProgressRing({
  percent,
  size = 84,
  stroke = 9,
  status,
  label,
}: {
  percent: number;
  size?: number;
  stroke?: number;
  status?: 'ok' | 'near' | 'over';
  label?: string;
}) {
  // The main arc can only fill one full circle, but the percent itself
  // must never be clamped: at 120% used the ring used to show "100%"
  // while the label next to it said 120%. The centre number now shows
  // the true percent, the main arc stays full once past 100%, and the
  // overflow (percent - 100) is drawn as a thin outer arc so going over
  // budget is visibly past full.
  const display = Math.max(0, percent);
  const arcPercent = Math.min(100, display);
  const overflow = Math.max(0, Math.min(100, display - 100));
  const [drawn, setDrawn] = useState(0);
  const [drawnOverflow, setDrawnOverflow] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => {
      setDrawn(arcPercent);
      setDrawnOverflow(overflow);
    }, 60);
    return () => window.clearTimeout(t);
  }, [arcPercent, overflow]);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  // The overflow arc sits outside the main ring, so the SVG canvas is
  // padded out by `pad` and absolutely positioned to stay centred.
  const pad = stroke + 4;
  const svgSize = size + pad * 2;
  const centre = svgSize / 2;
  const or = r + stroke + 2;
  const oc = 2 * Math.PI * or;
  const color =
    status === 'over' ? 'var(--danger)' : status === 'near' ? 'var(--near)' : 'var(--accent)';
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={Math.round(display)}
      aria-valuemin={0}
      aria-valuemax={Math.max(100, Math.round(display))}
      aria-label={label ?? `Progress ${Math.round(display)} percent`}
    >
      <svg
        width={svgSize}
        height={svgSize}
        style={{ position: 'absolute', left: -pad, top: -pad, overflow: 'visible' }}
      >
        <circle cx={centre} cy={centre} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle
          className="ring-anim"
          cx={centre}
          cy={centre}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (drawn / 100) * c}
        />
        {overflow > 0 ? (
          <circle
            className="ring-anim"
            cx={centre}
            cy={centre}
            r={or}
            fill="none"
            stroke={color}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={oc}
            strokeDashoffset={oc - (drawnOverflow / 100) * oc}
          />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="body-4 tabular-nums">{Math.round(display)}%</span>
      </div>
    </div>
  );
}

/** Dialog with a scale+fade pop-in on open and a matching pop-out on
 *  close (unmount is delayed 300ms so the exit animation plays). */
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | null>(null);

  function requestClose() {
    if (closing) return;
    setClosing(true);
    timer.current = window.setTimeout(onClose, 300);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') requestClose();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (timer.current) window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${closing ? 'anim-overlay-out' : 'anim-overlay'}`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div
        className={`card relative w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto p-6 shadow-xl ${
          closing ? 'anim-modal-out' : 'anim-modal'
        }`}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="title-2">{title}</h2>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="btn btn-ghost btn-sm shrink-0"
          >
            <IconClose size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Loading state (skill B9): skeleton bars shaped like the content
 *  that is coming, not a circular spinner. Bars pulse with opacity
 *  only — no gradients. */
export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      className="flex flex-col gap-3 py-10"
      role="status"
      aria-label={label}
    >
      <div className="h-4 w-3/4 animate-pulse rounded-lg" style={{ background: 'var(--surface-2)' }} />
      <div className="h-4 w-full animate-pulse rounded-lg" style={{ background: 'var(--surface-2)' }} />
      <div className="h-4 w-2/3 animate-pulse rounded-lg" style={{ background: 'var(--surface-2)' }} />
      <span className="caption-5 mt-1" style={{ color: 'var(--muted)' }}>
        {label}
      </span>
    </div>
  );
}

/** Inline line-art illustrations for empty states. Drawn with the
 *  theme tokens (black/white only — a softer grey for the second stroke),
 *  so they look right in both themes. */
function EmptyArt({ kind }: { kind: 'transactions' | 'budgets' | 'goals' | 'accounts' | 'generic' }) {
  const accent = 'var(--accent)';
  const deep = 'var(--accent-2)';
  const muted = 'var(--muted)';
  const common = {
    width: 120,
    height: 84,
    viewBox: '0 0 120 84',
    fill: 'none',
    'aria-hidden': true,
  } as const;
  if (kind === 'transactions') {
    return (
      <svg {...common} strokeLinecap="round" strokeLinejoin="round">
        <rect x="34" y="8" width="52" height="68" rx="8" stroke={accent} strokeWidth="2.5" />
        <line x1="44" y1="22" x2="76" y2="22" stroke={deep} strokeWidth="2.5" />
        <line x1="44" y1="34" x2="76" y2="34" stroke={muted} strokeWidth="2" opacity="0.55" />
        <line x1="44" y1="44" x2="66" y2="44" stroke={muted} strokeWidth="2" opacity="0.55" />
        <line x1="44" y1="54" x2="76" y2="54" stroke={muted} strokeWidth="2" opacity="0.55" />
        <circle cx="90" cy="64" r="12" fill="var(--accent-soft)" stroke={accent} strokeWidth="2" />
        <path d="M84 64h12M90 58v12" stroke={accent} strokeWidth="2" />
      </svg>
    );
  }
  if (kind === 'budgets') {
    return (
      <svg {...common} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="52" cy="42" r="28" stroke={accent} strokeWidth="2.5" />
        <path d="M52 42 L52 14 A28 28 0 0 1 76 22 Z" fill="var(--accent-soft)" stroke={accent} strokeWidth="2" />
        <path d="M52 42 L78 58" stroke={deep} strokeWidth="2.5" />
        <circle cx="96" cy="62" r="9" fill="var(--accent-soft)" stroke={deep} strokeWidth="2" />
        <path d="M96 57v10" stroke={deep} strokeWidth="2" />
      </svg>
    );
  }
  if (kind === 'goals') {
    return (
      <svg {...common} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="54" cy="42" r="26" stroke={accent} strokeWidth="2.5" />
        <circle cx="54" cy="42" r="15" stroke={deep} strokeWidth="2.5" />
        <circle cx="54" cy="42" r="5" fill={accent} />
        <path d="M74 22 L94 8 M94 8 h-12 M94 8 v12" stroke={deep} strokeWidth="2.5" />
      </svg>
    );
  }
  if (kind === 'accounts') {
    return (
      <svg {...common} strokeLinecap="round" strokeLinejoin="round">
        <rect x="22" y="24" width="76" height="44" rx="9" stroke={accent} strokeWidth="2.5" />
        <line x1="22" y1="38" x2="98" y2="38" stroke={deep} strokeWidth="2.5" />
        <rect x="30" y="50" width="18" height="6" rx="2" fill="var(--accent-soft)" stroke={deep} strokeWidth="1.5" />
        <circle cx="86" cy="54" r="7" fill="var(--accent-soft)" stroke={accent} strokeWidth="2" />
      </svg>
    );
  }
  return (
    <svg {...common} strokeLinecap="round" strokeLinejoin="round">
      <rect x="26" y="18" width="68" height="48" rx="9" stroke={accent} strokeWidth="2.5" />
      <line x1="38" y1="32" x2="82" y2="32" stroke={deep} strokeWidth="2.5" />
      <line x1="38" y1="44" x2="70" y2="44" stroke={muted} strokeWidth="2" opacity="0.55" />
      <line x1="38" y1="54" x2="78" y2="54" stroke={muted} strokeWidth="2" opacity="0.55" />
    </svg>
  );
}

export function EmptyState({
  title,
  hint,
  action,
  art = 'generic',
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  art?: 'transactions' | 'budgets' | 'goals' | 'accounts' | 'generic';
}) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <div aria-hidden>
        <EmptyArt kind={art} />
      </div>
      <p className="body-5">{title}</p>
      {hint ? (
        <p className="max-w-md body-6" style={{ color: 'var(--muted)' }}>
          {hint}
        </p>
      ) : null}
      {action}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
  icon,
  countTo,
  format,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'good' | 'bad' | 'neutral';
  icon?: ReactNode;
  /** When set, the value counts up to this number (formatted by `format`). */
  countTo?: number;
  format?: (n: number) => string;
}) {
  /* Monochrome tone: "good" is solid text (bold, black/white),
     "bad" is regular grey — the +/− sign and the label carry the
     meaning, never a colour. */
  const color =
    tone === 'good'
      ? 'var(--text)'
      : tone === 'bad'
        ? 'var(--muted)'
        : 'var(--text)';
  return (
    <div className="card card-hover p-4">
      <div className="flex items-center gap-2">
        {icon ? <span className={`stat-icon ${tone === 'bad' ? 'rose' : ''}`}>{icon}</span> : null}
        <p className="caption-4" style={{ color: 'var(--muted)' }}>
          {label}
        </p>
      </div>
      <p className="heading-5 mt-2 tabular-nums" style={{ color }}>
        {countTo !== undefined && format ? (
          <CountUp value={countTo} format={format} />
        ) : (
          value
        )}
      </p>
      {sub ? (
        <p className="caption-5 mt-0.5" style={{ color: 'var(--muted)' }}>
          {sub}
        </p>
      ) : null}
    </div>
  );
}

export function ProgressBar({
  percent,
  status,
}: {
  percent: number;
  status?: 'ok' | 'near' | 'over';
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  // Grow from 0 on mount so the bar visibly fills in.
  const [drawn, setDrawn] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setDrawn(clamped), 60);
    return () => window.clearTimeout(t);
  }, [clamped]);
  const bg =
    status === 'over' ? 'var(--danger)' : status === 'near' ? 'var(--near)' : 'var(--accent)';
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full"
      style={{ background: 'var(--border)' }}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full w-full origin-left rounded-full"
        style={{
          transform: `scaleX(${drawn / 100})`,
          background: bg,
          transition: 'transform 700ms var(--ease-out)',
        }}
      />
    </div>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="caption-5 mt-1" style={{ color: 'var(--danger)' }}>
      {message}
    </p>
  );
}

/** Inline load error (skill B9): a composed card that says what
 *  failed and offers a retry, instead of spinning forever. Pages
 *  render this when their query errors. */
export function QueryError({
  title = 'Could not load this page',
  onRetry,
}: {
  title?: string;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      title={title}
      hint="Check that the backend is running, then try again."
      action={
        onRetry ? (
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            Retry
          </button>
        ) : undefined
      }
    />
  );
}

/** Tagline reveal (skill B11): the app's core benefit as a two-line
 *  moment. Each word starts at 30% text colour and transitions to
 *  full colour in reading order as the section scrolls into view,
 *  on the base curve. Under reduced motion the final text shows
 *  right away. */
export function TaglineReveal({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // No animation: show the final text. Deferred so the effect
      // never sets state synchronously.
      const t = window.setTimeout(() => {
        setReduced(true);
        setVisible(true);
      }, 0);
      return () => window.clearTimeout(t);
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /* Word rows with their global reading-order index, computed purely
     (no mutation during render). */
  const rows = lines.map((line, li) => ({
    words: line.split(' '),
    start: lines.slice(0, li).reduce((acc, l) => acc + l.split(' ').length, 0),
  }));

  return (
    <p
      ref={ref}
      className="heading-3 text-center"
      style={{ maxWidth: 680 }}
      aria-label={lines.join(' ')}
    >
      {rows.map((row, li) => (
        <span key={li} className="block">
          {row.words.map((word, wi) => {
            const delay = reduced ? 0 : Math.min((row.start + wi) * 60, 400);
            return (
              <span
                key={`${li}-${wi}`}
                aria-hidden
                style={{
                  color: visible
                    ? 'var(--text)'
                    : 'color-mix(in srgb, var(--text) 30%, transparent)',
                  transition: `color 600ms var(--ease-out) ${delay}ms`,
                }}
              >
                {word}{' '}
              </span>
            );
          })}
        </span>
      ))}
    </p>
  );
}
