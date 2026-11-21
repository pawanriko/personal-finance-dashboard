import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, fetchAll, ApiError } from '../lib/api';
import type { Account, Paginated, Transaction } from '../lib/types';
import { fmtDate, fmtMoney } from '../lib/utils';
import { EmptyState, FieldError, Modal, Spinner } from '../components/ui';

const ACCOUNT_TYPES = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'cash', label: 'Cash' },
] as const;

function AccountForm({
  initial,
  defaultCurrency,
  onSaved,
  onCancel,
}: {
  initial: Account | null;
  defaultCurrency: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<string>(initial?.type ?? 'checking');
  const [currency, setCurrency] = useState(initial?.currency ?? defaultCurrency);
  const [opening, setOpening] = useState(initial?.opening_balance ?? '0.00');
  const [error, setError] = useState('');
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => {
      const payload = { name: name.trim(), type, currency: currency.trim().toUpperCase(), opening_balance: opening };
      if (initial) return api.patch<Account>(`/accounts/${initial.id}/`, payload);
      return api.post<Account>('/accounts/', payload);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      onSaved();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.detail : 'Could not save the account.');
    },
  });
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
        <label className="label" htmlFor="ac-name">Name</label>
        <input id="ac-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HDFC Savings" required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="ac-type">Type</label>
          <select id="ac-type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ac-currency">Currency</label>
          <input id="ac-currency" className="input" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value)} required />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="ac-opening">Opening balance</label>
        <input
          id="ac-opening"
          className="input"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={opening}
          onChange={(e) => setOpening(e.target.value)}
          required
        />
      </div>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        The balance is always computed from the opening balance plus the
        transaction ledger — it can never go stale.
      </p>
      <FieldError message={error} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : initial ? 'Save changes' : 'Add account'}
        </button>
      </div>
    </form>
  );
}

function AccountHistory({ account }: { account: Account }) {
  const history = useQuery({
    queryKey: ['account-history', account.id],
    queryFn: () => api.get<Paginated<Transaction>>(`/accounts/${account.id}/history/`),
  });
  if (history.isLoading) return <Spinner label="Loading history…" />;
  if (!history.data || history.data.results.length === 0) {
    return <p className="text-sm" style={{ color: 'var(--muted)' }}>No transactions on this account yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="table-head">Date</th>
            <th className="table-head">Merchant</th>
            <th className="table-head">Category</th>
            <th className="table-head text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {history.data.results.map((tx) => (
            <tr key={tx.id}>
              <td className="table-cell whitespace-nowrap">{fmtDate(tx.date)}</td>
              <td className="table-cell">
                {tx.merchant || '—'}
                {tx.is_transfer ? <span className="badge badge-grey ml-2">transfer</span> : null}
              </td>
              <td className="table-cell">{tx.category_name ?? '—'}</td>
              <td
                className="table-cell text-right font-medium tabular-nums"
                style={{ color: tx.type === 'income' ? 'var(--good)' : 'var(--danger)' }}
              >
                {tx.type === 'income' ? '+' : '−'}{fmtMoney(tx.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AccountsPage() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [detail, setDetail] = useState<Account | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);

  const list = useQuery({ queryKey: ['accounts'], queryFn: () => fetchAll<Account>('/accounts/') });
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api.get<{ default_currency: string }>('/profile/') });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/accounts/${id}/`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      setDeleting(null);
      setDetail(null);
    },
  });

  const accounts = list.data ?? [];
  const typeLabel = (t: string) => ACCOUNT_TYPES.find((x) => x.value === t)?.label ?? t;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Accounts</h1>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Checking, savings, credit cards and cash. For a credit card, a
            negative balance means the amount owed.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
          + Add account
        </button>
      </div>

      {list.isLoading ? (
        <Spinner label="Loading accounts…" />
      ) : accounts.length === 0 ? (
        <EmptyState
          title="No accounts yet"
          hint="Create your first account — a bank account, wallet or cash — and set its opening balance. Transactions and budgets build on it."
          action={<button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>+ Add account</button>}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {accounts.map((a) => (
            <div key={a.id} className="card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{a.name}</p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    {typeLabel(a.type)} · {a.currency}
                  </p>
                </div>
                {!a.is_active ? <span className="badge badge-grey">inactive</span> : null}
              </div>
              <p
                className="mt-3 text-2xl font-semibold tabular-nums"
                style={{ color: Number(a.balance) < 0 ? 'var(--danger)' : 'var(--text)' }}
              >
                {fmtMoney(a.balance, a.currency)}
              </p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                Opening {fmtMoney(a.opening_balance, a.currency)}
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDetail(a)}>History</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(a)}>Edit</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(a)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <Modal title="Add account" onClose={() => setAdding(false)}>
          <AccountForm initial={null} defaultCurrency={profile.data?.default_currency ?? 'INR'} onSaved={() => setAdding(false)} onCancel={() => setAdding(false)} />
        </Modal>
      ) : null}
      {editing ? (
        <Modal title={`Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <AccountForm initial={editing} defaultCurrency={editing.currency} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} />
        </Modal>
      ) : null}
      {detail ? (
        <Modal title={`${detail.name} — history`} wide onClose={() => setDetail(null)}>
          <AccountHistory account={detail} />
        </Modal>
      ) : null}
      {deleting ? (
        <Modal title="Delete account?" onClose={() => setDeleting(null)}>
          <p className="text-sm">
            Delete “{deleting.name}” (balance {fmtMoney(deleting.balance, deleting.currency)})?
            Its transactions are deleted with it.
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
