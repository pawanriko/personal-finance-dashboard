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

const PIE_COLORS = ['#0f766e', '#0284c7', '#7c3aed', '#db2777', '#ea580c', '#ca8a04', '#16a34a', '#475569'];

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
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Reports</h1>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
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
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat label="Income" value={fmtMoney(query.data.income)} sub={deltaLabel(query.data.income, query.data.previous_period.income)} tone="good" />
            <Stat label="Expenses" value={fmtMoney(query.data.expenses)} sub={deltaLabel(query.data.expenses, query.data.previous_period.expenses)} tone="bad" />
            <Stat
              label="Net"
              value={fmtMoney(query.data.net)}
              sub={`${fmtDate(query.data.period.start)} – ${fmtDate(query.data.period.end)}`}
              tone={Number(query.data.net) >= 0 ? 'good' : 'bad'}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card p-4">
              <h2 className="text-sm font-semibold">Spending by category</h2>
              {pieData.length === 0 ? (
                <p className="py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>No expenses in this period.</p>
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={100} label>
                        {pieData.map((entry, i) => (
                          <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => fmtMoney(String(v))} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
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
              <h2 className="text-sm font-semibold">Income vs expenses by month</h2>
              {barData.length === 0 ? (
                <p className="py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>No data in this period.</p>
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="month" tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                      <YAxis tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                      <Tooltip formatter={(v) => fmtMoney(String(v))} />
                      <Legend />
                      <Bar dataKey="income" fill="#15803d" name="Income" />
                      <Bar dataKey="expenses" fill="#b91c1c" name="Expenses" />
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
