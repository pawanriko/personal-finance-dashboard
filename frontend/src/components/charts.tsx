/** Shared chart styling: one category palette and one tooltip, so every
 *  chart in the app reads as the same product. Fills are flat colours
 *  (skill B4 — no gradients in backgrounds). */

import { useTheme } from '../lib/theme';

/** Monochrome category palette (light theme): greys only, from
 *  near-black to pale grey, plus two neutral slates for overflow
 *  categories. No colour at all — categories are told apart by grey
 *  depth and the legend. */

export const CATEGORY_COLORS = [
  '#000000', // black
  '#404040', // dark grey
  '#737373', // mid grey
  '#a3a3a3', // grey
  '#d4d4d4', // pale grey
  '#262626', // near-black
  '#525252', // charcoal
  '#8a8a8a', // silver grey
  '#e5e5e5', // very pale grey
  '#171717', // soft black
];

/** Dark-theme palette: the same greys reversed, brightest first, so
 *  slices stay visible on a pure-black card (a black slice on black
 *  would read as a hole). */
export const CATEGORY_COLORS_DARK = [
  '#ffffff', // white
  '#d4d4d4', // pale grey
  '#a3a3a3', // grey
  '#737373', // mid grey
  '#525252', // charcoal
  '#e5e5e5', // very pale grey
  '#8a8a8a', // silver grey
  '#404040', // dark grey
  '#262626', // near-black
  '#f5f5f5', // near-white
];

/** Theme-aware palette for Pie/Bar cells. */
export function useCategoryColors(): string[] {
  const { theme } = useTheme();
  return theme === 'dark' ? CATEGORY_COLORS_DARK : CATEGORY_COLORS;
}

/** Legend label formatter: Recharts colours legend text with the
 *  series/cell colour, which would make dark-grey categories
 *  unreadable on a black card — force the label to the theme text
 *  colour and let only the swatch carry the category grey. */
export function legendText(value: string) {
  return <span style={{ color: 'var(--text)' }}>{value}</span>;
}

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
      className="rounded-lg border px-3 py-2 body-6 shadow-lg"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}
    >
      {label !== undefined && label !== '' ? (
        <p className="mb-1 caption-3" style={{ color: 'var(--muted)' }}>
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
