import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, qs } from '../lib/api';
import type { ReportsSummary } from '../lib/types';
import { fmtDate, fmtMoney, fmtMonthLabel, monthEnd, monthStart, todayIso } from '../lib/utils';
import { EmptyState, Spinner, Stat } from '../components/ui';
import { EXPENSE_FILL, INCOME_FILL, MoneyTooltip, legendText, useCategoryColors } from '../components/charts';
import { IconArrowDown, IconArrowUp, IconTransactions } from '../components/icons';

function deltaLabel(current: string, previous: string): string {
  const c = Number(current);
  const p = Number(previous);
  if (p === 0) return 'no previous period';
  const pct = ((c - p) / Math.abs(p)) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}% vs previous`;
}

export function ReportsPage() {
  const now = new Date();
  const [start, setStart] = useState(monthStart(now));
  const categoryColors = useCategoryColors();
  const [end, setEnd] = useState(monthEnd(now));

  const query = useQuery({
    queryKey: ['reports', start, end],
    queryFn: () => api.get<ReportsSummary>(`/reports/${qs({ start, end })}`),
  });

  const pieData = useMemo(
    () =>
      (query.data?.spending_by_category ?? []).map((row) => ({
        name: row.category,
        value: Number(row.total),
      })),
    [query.data],
  );
  const barData = useMemo(
    () =>
      (query.data?.monthly_series ?? []).map((row) => ({
        month: fmtMonthLabel(row.month),
        income: Number(row.income),
        expenses: Number(row.expenses),
      })),
    [query.data],
  );

  function preset(kind: 'month' | 'last-month' | 'year') {
    const d = new Date();
    if (kind === 'month') {
      setStart(monthStart(d));
      setEnd(monthEnd(d));
    } else if (kind === 'last-month') {
      const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      setStart(monthStart(prev));
      setEnd(monthEnd(prev));
    } else {
      setStart(`${d.getFullYear()}-01-01`);
      setEnd(todayIso());
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="heading-6">Reports</h1>
          <p className="body-6" style={{ color: 'var(--muted)' }}>
            Summaries for any date range, compared with the previous period of
            the same length.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void api.download(`/reports/export/${qs({ start, end })}`, 'report.csv')}
        >
          Export report CSV
        </button>
      </div>

      <div className="card flex flex-wrap items-center gap-3 p-4">
        <div>
          <label className="label" htmlFor="rep-start">From</label>
          <input id="rep-start" className="input w-44" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="rep-end">To</label>
          <input id="rep-end" className="input w-44" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div className="flex gap-2 pt-5">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => preset('month')}>This month</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => preset('last-month')}>Last month</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => preset('year')}>This year</button>
        </div>
      </div>

      {query.isLoading ? (
        <Spinner label="Loading report…" />
      ) : query.isError || !query.data ? (
        <EmptyState
          title="Could not load the report"
          hint="Check that the backend is running, then try again."
          action={<button type="button" className="btn btn-primary" onClick={() => void query.refetch()}>Retry</button>}
        />
      ) : (
        <>
          <div className="blur-siblings lift-on-hover grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat label="Income" value={fmtMoney(query.data.income)} sub={deltaLabel(query.data.income, query.data.previous_period.income)} tone="good" icon={<IconArrowUp size={16} />} countTo={Number(query.data.income)} format={(n) => fmtMoney(n.toFixed(2))} />
            <Stat label="Expenses" value={fmtMoney(query.data.expenses)} sub={deltaLabel(query.data.expenses, query.data.previous_period.expenses)} tone="bad" icon={<IconArrowDown size={16} />} countTo={Number(query.data.expenses)} format={(n) => fmtMoney(n.toFixed(2))} />
            <Stat
              label="Net"
              value={fmtMoney(query.data.net)}
              sub={`${fmtDate(query.data.period.start)} – ${fmtDate(query.data.period.end)}`}
              tone={Number(query.data.net) >= 0 ? 'good' : 'bad'}
              icon={<IconTransactions size={16} />}
              countTo={Number(query.data.net)}
              format={(n) => fmtMoney(n.toFixed(2))}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card p-4">
              <h2 className="title-4">Spending by category</h2>
              {pieData.length === 0 ? (
                <p className="body-6 py-8 text-center" style={{ color: 'var(--muted)' }}>No expenses in this period.</p>
              ) : (
                <div className="relative h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={68}
                        outerRadius={98}
                        paddingAngle={2}
                        cornerRadius={4}
                        stroke="var(--border)"
                        strokeWidth={2}
                      >
                        {pieData.map((entry, i) => (
                          <Cell key={entry.name} fill={categoryColors[i % categoryColors.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<MoneyTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-6">
                    <p className="caption-5" style={{ color: 'var(--muted)' }}>
                      Total spent
                    </p>
                    <p className="body-4 tabular-nums">{fmtMoney(query.data.expenses)}</p>
                  </div>
                </div>
              )}
              {pieData.length > 0 ? (
                <table className="mt-2 w-full border-collapse">
                  <tbody>
                    {query.data.spending_by_category.map((row) => (
                      <tr key={row.category}>
                        <td className="table-cell">{row.category}</td>
                        <td className="table-cell text-right tabular-nums">{fmtMoney(row.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
            <div className="card p-4">
              <h2 className="title-4">Income vs expenses by month</h2>
              {barData.length === 0 ? (
                <p className="body-6 py-8 text-center" style={{ color: 'var(--muted)' }}>No data in this period.</p>
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData} barCategoryGap="28%">
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="month" tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip content={<MoneyTooltip />} cursor={{ fill: 'var(--surface-2)' }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
                      <Bar dataKey="income" fill={INCOME_FILL} name="Income" radius={[6, 6, 0, 0]} maxBarSize={28} />
                      <Bar dataKey="expenses" fill={EXPENSE_FILL} name="Expenses" radius={[6, 6, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <table className="mt-2 w-full border-collapse">
                <tbody>
                  {query.data.monthly_series.map((row) => (
                    <tr key={row.month}>
                      <td className="table-cell">{fmtMonthLabel(row.month)}</td>
                      <td className="table-cell text-right tabular-nums" style={{ color: 'var(--good)' }}>
                        +{fmtMoney(row.income)}
                      </td>
                      <td className="table-cell text-right tabular-nums" style={{ color: 'var(--danger)' }}>
                        −{fmtMoney(row.expenses)}
                      </td>
                      <td className="table-cell text-right font-medium tabular-nums">{fmtMoney(row.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
