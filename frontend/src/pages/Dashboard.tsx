import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
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
import { api } from '../lib/api';
import type { DashboardSummary } from '../lib/types';
import { fmtDate, fmtMoney, fmtMonthLabel, monthEnd, monthStart, shiftMonth } from '../lib/utils';
import { EmptyState, ProgressBar, Spinner, Stat } from '../components/ui';

const PIE_COLORS = ['#0f766e', '#0284c7', '#7c3aed', '#db2777', '#ea580c', '#ca8a04', '#16a34a', '#475569'];

function deltaLabel(current: string, previous: string): string {
  const c = Number(current);
  const p = Number(previous);
  if (p === 0) return 'no previous period';
  const pct = ((c - p) / Math.abs(p)) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}% vs previous`;
}

export function DashboardPage() {
  const now = new Date();
  const [month, setMonth] = useState(monthStart(now));
  const start = month;
  const end = monthEnd(new Date(`${month}T00:00:00`));

  const query = useQuery({
    queryKey: ['dashboard', start, end],
    queryFn: () => api.get<DashboardSummary>(`/dashboard/?start=${start}&end=${end}`),
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

  if (query.isLoading) return <Spinner label="Loading dashboard…" />;
  if (query.isError || !query.data) {
    return (
      <EmptyState
        title="Could not load the dashboard"
        hint="Check that the backend is running, then try again."
        action={
          <button type="button" className="btn btn-primary" onClick={() => void query.refetch()}>
            Retry
          </button>
        }
      />
    );
  }

  const d = query.data;
  const balances = Object.entries(d.total_balances);
  const hasData = balances.length > 0 || Number(d.income) > 0 || Number(d.expenses) > 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {fmtMonthLabel(month)} · {fmtDate(start)} – {fmtDate(end)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
            ← Prev
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMonth(monthStart(new Date()))}>
            This month
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
            Next →
          </button>
        </div>
      </div>

      {!hasData ? (
        <EmptyState
          title="Nothing here yet"
          hint="Add your first account, then record an income or expense — the dashboard fills in from there."
          action={
            <Link to="/accounts" className="btn btn-primary">
              Add an account
            </Link>
          }
        />
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Total balance
          </p>
          {balances.map(([currency, total]) => (
            <p key={currency} className="mt-1 text-2xl font-semibold tabular-nums">
              {fmtMoney(total, currency)}
            </p>
          ))}
          {balances.length === 0 ? <p className="mt-1 text-2xl font-semibold">—</p> : null}
        </div>
        <Stat
          label="Income"
          value={fmtMoney(d.income)}
          sub={deltaLabel(d.income, d.previous_period.income)}
          tone="good"
        />
        <Stat
          label="Expenses"
          value={fmtMoney(d.expenses)}
          sub={deltaLabel(d.expenses, d.previous_period.expenses)}
          tone="bad"
        />
        <Stat
          label="Net cash flow"
          value={fmtMoney(d.net)}
          sub={deltaLabel(d.net, d.previous_period.net)}
          tone={Number(d.net) >= 0 ? 'good' : 'bad'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h2 className="text-sm font-semibold">Spending by category</h2>
          {pieData.length === 0 ? (
            <p className="py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>
              No expenses in this period.
            </p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={90} label>
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
        </div>
        <div className="card p-4">
          <h2 className="text-sm font-semibold">Income vs expenses</h2>
          {barData.length === 0 ? (
            <p className="py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>
              No data in this period.
            </p>
          ) : (
            <div className="h-64">
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
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Budget status</h2>
            <Link to="/budgets" className="text-xs font-medium" style={{ color: 'var(--accent)' }}>
              All budgets →
            </Link>
          </div>
          {d.budgets.length === 0 ? (
            <p className="py-4 text-sm" style={{ color: 'var(--muted)' }}>
              No budgets for this month yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {d.budgets.map((b) => (
                <li key={b.budget_id}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span>{b.category}</span>
                    <span className="tabular-nums" style={{ color: 'var(--muted)' }}>
                      {fmtMoney(b.spent)} of {fmtMoney(b.limit)} · {b.percent_used}%
                    </span>
                  </div>
                  <ProgressBar percent={b.percent_used} status={b.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recent activity</h2>
            <Link to="/transactions" className="text-xs font-medium" style={{ color: 'var(--accent)' }}>
              All transactions →
            </Link>
          </div>
          {d.recent_transactions.length === 0 ? (
            <p className="py-4 text-sm" style={{ color: 'var(--muted)' }}>
              No transactions yet.
            </p>
          ) : (
            <ul className="flex flex-col divide-y" style={{ borderColor: 'var(--border)' }}>
              {d.recent_transactions.map((tx) => (
                <li key={tx.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{tx.merchant || tx.category_name || 'Transaction'}</p>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>
                      {fmtDate(tx.date)} · {tx.account_name}
                      {tx.category_name ? ` · ${tx.category_name}` : ''}
                    </p>
                  </div>
                  <span
                    className="shrink-0 font-medium tabular-nums"
                    style={{ color: tx.type === 'income' ? 'var(--good)' : 'var(--danger)' }}
                  >
                    {tx.type === 'income' ? '+' : '−'}
                    {fmtMoney(tx.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
