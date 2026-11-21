import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, fetchAll, qs, ApiError } from '../lib/api';
import type { Budget, Category } from '../lib/types';
import { fmtMoney, monthStart, shiftMonth, fmtMonthLabel } from '../lib/utils';
import { EmptyState, FieldError, Modal, ProgressBar, Spinner } from '../components/ui';

function BudgetForm({
  initial,
  categories,
  month,
  onSaved,
  onCancel,
}: {
  initial: Budget | null;
  categories: Category[];
  month: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState(initial ? String(initial.category) : '');
  const [limit, setLimit] = useState(initial ? initial.limit : '');
  const [error, setError] = useState('');
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => {
      const payload = { category: Number(category), month, limit };
      if (initial) return api.patch<Budget>(`/budgets/${initial.id}/`, payload);
      return api.post<Budget>('/budgets/', payload);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['budgets'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      onSaved();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.detail : 'Could not save the budget.');
    },
  });
  const expenseCats = categories.filter((c) => c.type === 'expense');
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        setError('');
        save.mutate();
      }}
    >
      <div>
        <label className="label" htmlFor="bg-category">Category (expense)</label>
        <select
          id="bg-category"
          className="input"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          disabled={!!initial}
          required
        >
          <option value="">Choose a category…</option>
          {expenseCats.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="bg-limit">Monthly limit</label>
        <input
          id="bg-limit"
          className="input"
          type="number"
          min="0.01"
          step="0.01"
          inputMode="decimal"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          required
        />
      </div>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        Budgets apply to one month only and do not carry forward.
      </p>
      <FieldError message={error} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : initial ? 'Save changes' : 'Add budget'}
        </button>
      </div>
    </form>
  );
}

export function BudgetsPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(monthStart(new Date()));
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [deleting, setDeleting] = useState<Budget | null>(null);

  const categoriesQ = useQuery({ queryKey: ['categories'], queryFn: () => fetchAll<Category>('/categories/') });
  const list = useQuery({
    queryKey: ['budgets', month],
    queryFn: () => fetchAll<Budget>(`/budgets/${qs({ month })}`),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/budgets/${id}/`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['budgets'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      setDeleting(null);
    },
  });

  const categories = categoriesQ.data ?? [];
  const budgets = useMemo(() => list.data ?? [], [list.data]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Budgets</h1>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Monthly spending limits per category. Near means ≥80% spent, over
            means over 100%.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMonth((m) => shiftMonth(m, -1))}>← Prev</button>
          <span className="text-sm font-medium">{fmtMonthLabel(month)}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMonth((m) => shiftMonth(m, 1))}>Next →</button>
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>+ Add budget</button>
        </div>
      </div>

      {list.isLoading ? (
        <Spinner label="Loading budgets…" />
      ) : budgets.length === 0 ? (
        <EmptyState
          title={`No budgets for ${fmtMonthLabel(month)}`}
          hint="Set a monthly limit on an expense category — groceries, transport, entertainment — and watch spending against it."
          action={<button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>+ Add budget</button>}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {budgets.map((b) => (
            <div key={b.id} className="card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{b.category_name}</p>
                  <p className="text-sm tabular-nums" style={{ color: 'var(--muted)' }}>
                    {fmtMoney(b.spent)} of {fmtMoney(b.limit)} · {b.percent_used}%
                  </p>
                </div>
                <span className={`badge ${b.status === 'over' ? 'badge-red' : b.status === 'near' ? 'badge-amber' : 'badge-green'}`}>
                  {b.status === 'over' ? 'Over budget' : b.status === 'near' ? 'Near limit' : 'On track'}
                </span>
              </div>
              <div className="mt-3">
                <ProgressBar percent={b.percent_used} status={b.status} />
              </div>
              <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
                {Number(b.remaining) >= 0
                  ? `${fmtMoney(b.remaining)} remaining`
                  : `${fmtMoney(String(Math.abs(Number(b.remaining))))} over`}
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(b)}>Edit limit</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(b)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <Modal title={`Add budget — ${fmtMonthLabel(month)}`} onClose={() => setAdding(false)}>
          <BudgetForm categories={categories} month={month} initial={null} onSaved={() => setAdding(false)} onCancel={() => setAdding(false)} />
        </Modal>
      ) : null}
      {editing ? (
        <Modal title={`Edit budget — ${editing.category_name}`} onClose={() => setEditing(null)}>
          <BudgetForm categories={categories} month={month} initial={editing} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} />
        </Modal>
      ) : null}
      {deleting ? (
        <Modal title="Delete budget?" onClose={() => setDeleting(null)}>
          <p className="text-sm">
            Delete the {deleting.category_name} budget for {fmtMonthLabel(month)} ({fmtMoney(deleting.limit)})?
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setDeleting(null)}>Cancel</button>
            <button type="button" className="btn btn-danger" onClick={() => remove.mutate(deleting.id)} disabled={remove.isPending}>
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
