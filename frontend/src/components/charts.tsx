/** Shared chart styling: one category palette and one tooltip, so every
 *  chart in the app reads as the same product. Fills are flat colours
 *  (skill B4 — no gradients in backgrounds). */

export const CATEGORY_COLORS = [
  '#0e9f6e', // emerald
  '#0b6b4a', // deep emerald
  '#d4a017', // gold
  '#0284c7', // sky
  '#7c3aed', // violet
  '#db2777', // pink
  '#ea580c', // orange
  '#14b8a6', // teal
  '#64748b', // slate
  '#84cc16', // lime
];

/** Flat fills for income/expense bars and areas, from the semantic
 *  money tokens. */
export const INCOME_FILL = 'var(--income)';
export const EXPENSE_FILL = 'var(--expense)';

/** Card-styled tooltip for Recharts. Values are money amounts unless
 *  `money` is false. */
export function MoneyTooltip({
  active,
  payload,
  label,
  money = true,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string; fill?: string }>;
  label?: string | number;
  money?: boolean;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      className="rounded-lg border px-3 py-2 text-sm shadow-lg"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}
    >
      {label !== undefined && label !== '' ? (
        <p className="mb-1 text-xs font-semibold" style={{ color: 'var(--muted)' }}>
          {label}
        </p>
      ) : null}
      {payload.map((row) => (
        <p key={String(row.name)} className="flex items-center gap-2 tabular-nums">
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ background: row.color || row.fill || 'var(--accent)' }}
          />
          <span style={{ color: 'var(--muted)' }}>{row.name}</span>
          <span className="ml-auto font-medium">
            {money ? formatMoney(Number(row.value ?? 0)) : String(row.value ?? '')}
          </span>
        </p>
      ))}
    </div>
  );
}

function formatMoney(n: number): string {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `₹${n.toFixed(0)}`;
  }
}
