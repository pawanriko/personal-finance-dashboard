import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** Dialog with a scale+fade pop-in on open and a matching pop-out on
 *  close (unmount is delayed 140ms so the exit animation plays). */
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
    timer.current = window.setTimeout(onClose, 140);
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
        className={`card relative w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto p-5 shadow-xl ${
          closing ? 'anim-modal-out' : 'anim-modal'
        }`}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="btn btn-ghost btn-sm shrink-0"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm" style={{ color: 'var(--muted)' }}>
      <span
        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        aria-hidden
      />
      {label}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint ? (
        <p className="max-w-md text-sm" style={{ color: 'var(--muted)' }}>
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
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'good' | 'bad' | 'neutral';
}) {
  const color =
    tone === 'good'
      ? 'var(--good)'
      : tone === 'bad'
        ? 'var(--danger)'
        : 'var(--text)';
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums" style={{ color }}>
        {value}
      </p>
      {sub ? (
        <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
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
  const bg =
    status === 'over' ? 'var(--danger)' : status === 'near' ? 'var(--warn)' : 'var(--accent)';
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
        className="h-full rounded-full transition-all duration-300"
        style={{ width: `${clamped}%`, background: bg }}
      />
    </div>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>
      {message}
    </p>
  );
}
