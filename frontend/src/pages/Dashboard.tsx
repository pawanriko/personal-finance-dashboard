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
import { CountUp, EmptyState, ProgressBar, Spinner, Stat } from '../components/ui';
import { EXPENSE_FILL, INCOME_FILL, MoneyTooltip, legendText, useCategoryColors } from '../components/charts';
import {
  IconArrowDown,
  IconArrowRight,
  IconArrowUp,
  IconChevronLeft,
  IconChevronRight,
  IconCode,
  IconGithub,
  IconLinkedin,
  IconTransactions,
} from '../components/icons';

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
  const categoryColors = useCategoryColors();
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="heading-6">Dashboard</h1>
          <p className="body-6" style={{ color: 'var(--muted)' }}>
            {fmtMonthLabel(month)} · {fmtDate(start)} – {fmtDate(end)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
            <IconChevronLeft size={16} /> Prev
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMonth(monthStart(new Date()))}>
            This month
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
            Next <IconChevronRight size={16} />
          </button>
        </div>
      </div>

      {!hasData ? (
        <EmptyState
          art="transactions"
          title="Nothing here yet"
          hint="Add your first account, then record an income or expense — the dashboard fills in from there."
          action={
            <Link to="/accounts" className="btn btn-primary">
              Add an account
            </Link>
          }
        />
      ) : null}

      <div className="blur-siblings lift-on-hover grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="hero card card-hover col-span-2 p-6">
          <div className="flex items-center gap-2">
            <span className="stat-icon" aria-hidden>
              ₹
            </span>
            <p className="hero-label caption-4">Total balance</p>
          </div>
          {balances.map(([currency, total]) => (
            <p key={currency} className="hero-balance heading-4 mt-2 tabular-nums">
              <CountUp value={Number(total)} format={(n) => fmtMoney(n.toFixed(2), currency)} />
            </p>
          ))}
          {balances.length === 0 ? <p className="hero-balance heading-4 mt-2">—</p> : null}
          <p className="hero-sub caption-5 mt-1">
            {d.account_count} account{d.account_count === 1 ? '' : 's'} · {fmtMonthLabel(month)}
          </p>
        </div>
        <Stat
          label="Income"
          value={fmtMoney(d.income)}
          sub={deltaLabel(d.income, d.previous_period.income)}
          tone="good"
          icon={<IconArrowUp size={16} />}
          countTo={Number(d.income)}
          format={(n) => fmtMoney(n.toFixed(2))}
        />
        <Stat
          label="Expenses"
          value={fmtMoney(d.expenses)}
          sub={deltaLabel(d.expenses, d.previous_period.expenses)}
          tone="bad"
          icon={<IconArrowDown size={16} />}
          countTo={Number(d.expenses)}
          format={(n) => fmtMoney(n.toFixed(2))}
        />
        <Stat
          label="Net cash flow"
          value={fmtMoney(d.net)}
          sub={deltaLabel(d.net, d.previous_period.net)}
          tone={Number(d.net) >= 0 ? 'good' : 'bad'}
          icon={<IconTransactions size={16} />}
          countTo={Number(d.net)}
          format={(n) => fmtMoney(n.toFixed(2))}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card anim-stagger p-4" style={{ '--d': '60ms' } as React.CSSProperties}>
          <h2 className="title-4">Spending by category</h2>
          {pieData.length === 0 ? (
            <p className="body-6 py-8 text-center" style={{ color: 'var(--muted)' }}>
              No expenses in this period.
            </p>
          ) : (
            <div className="relative h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={62}
                    outerRadius={88}
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
                <p className="body-4 tabular-nums">{fmtMoney(d.expenses)}</p>
              </div>
            </div>
          )}
        </div>
        <div className="card anim-stagger p-4" style={{ '--d': '120ms' } as React.CSSProperties}>
          <h2 className="title-4">Income vs expenses</h2>
          {barData.length === 0 ? (
            <p className="body-6 py-8 text-center" style={{ color: 'var(--muted)' }}>
              No data in this period.
            </p>
          ) : (
            <div className="h-64">
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
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card anim-stagger p-4" style={{ '--d': '180ms' } as React.CSSProperties}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="title-4">Budget status</h2>
            <Link to="/budgets" className="caption-4 inline-flex items-center gap-1" style={{ color: 'var(--accent)' }}>
              All budgets <IconArrowRight size={12} />
            </Link>
          </div>
          {d.budgets.length === 0 ? (
            <p className="body-6 py-4" style={{ color: 'var(--muted)' }}>
              No budgets for this month yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {d.budgets.map((b) => (
                <li key={b.budget_id}>
                  <div className="mb-1 flex items-center justify-between body-6">
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
        <div className="card anim-stagger p-4" style={{ '--d': '240ms' } as React.CSSProperties}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="title-4">Recent activity</h2>
            <Link to="/transactions" className="caption-4 inline-flex items-center gap-1" style={{ color: 'var(--accent)' }}>
              All transactions <IconArrowRight size={12} />
            </Link>
          </div>
          {d.recent_transactions.length === 0 ? (
            <p className="body-6 py-4" style={{ color: 'var(--muted)' }}>
              No transactions yet.
            </p>
          ) : (
            <ul className="flex flex-col divide-y" style={{ borderColor: 'var(--border)' }}>
              {d.recent_transactions.map((tx) => (
                <li key={tx.id} className="flex items-center justify-between gap-3 py-2 body-6">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: tx.type === 'income' ? 'var(--income)' : 'var(--expense)' }}
                      aria-hidden
                    />
                    <div className="min-w-0">
                    <p className="body-5 truncate">{tx.merchant || tx.category_name || 'Transaction'}</p>
                    <p className="caption-5" style={{ color: 'var(--muted)' }}>
                      {fmtDate(tx.date)} · {tx.account_name}
                      {tx.category_name ? ` · ${tx.category_name}` : ''}
                    </p>
                    </div>
                  </div>
                  <span
                    className="shrink-0 font-medium tabular-nums"
                    style={{ color: tx.type === 'income' ? 'var(--text)' : 'var(--muted)' }}
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

      {/* Dashboard-only footer: "Made by Pawan" + his profiles. */}
      <footer className="card mt-2 flex flex-col items-center gap-3 px-6 py-6 text-center">
        <p className="title-3">Made by Pawan</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <a
            href="https://github.com/pawanriko"
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost btn-sm"
          >
            <IconGithub size={16} /> GitHub
          </a>
          <a
            href="https://www.linkedin.com/in/pawanriko"
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost btn-sm"
          >
            <IconLinkedin size={16} /> LinkedIn
          </a>
          <a
            href="https://leetcode.com/pawanriko"
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost btn-sm"
          >
            <IconCode size={16} /> LeetCode
          </a>
        </div>
        <p className="caption-5" style={{ color: 'var(--muted)' }}>
          Personal Finance Dashboard · Pawan Kumar
        </p>
      </footer>
    </div>
  );
}
