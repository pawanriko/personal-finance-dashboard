import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, fetchAll, qs, ApiError } from '../lib/api';
import type {
  Account,
  Category,
  Paginated,
  RecurringTransaction,
  Transaction,
} from '../lib/types';
import { fmtDate, fmtMoney, todayIso } from '../lib/utils';
import { EmptyState, FieldError, Modal, QueryError, Spinner } from '../components/ui';
import { IconChevronLeft, IconChevronRight } from '../components/icons';

interface TxForm {
  type: 'income' | 'expense';
  amount: string;
  date: string;
  account: string;
  category: string;
  merchant: string;
  notes: string;
}

const emptyForm = (accounts: Account[]): TxForm => ({
  type: 'expense',
  amount: '',
  date: todayIso(),
  account: accounts[0] ? String(accounts[0].id) : '',
  category: '',
  merchant: '',
  notes: '',
});

function TransactionForm({
  initial,
  accounts,
  categories,
  onSaved,
  onCancel,
}: {
  initial: Transaction | null;
  accounts: Account[];
  categories: Category[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<TxForm>(() =>
    initial
      ? {
          type: initial.type,
          amount: initial.amount,
          date: initial.date,
          account: String(initial.account),
          category: initial.category ? String(initial.category) : '',
          merchant: initial.merchant,
          notes: initial.notes,
        }
      : emptyForm(accounts),
  );
  const [error, setError] = useState('');
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        type: form.type,
        amount: form.amount,
        date: form.date,
        account: Number(form.account),
        category: form.category ? Number(form.category) : null,
        merchant: form.merchant.trim(),
        notes: form.notes.trim(),
      };
      if (initial) return api.patch<Transaction>(`/transactions/${initial.id}/`, payload);
      return api.post<Transaction>('/transactions/', payload);
    },
    // Wait for the refetch to land before closing the modal, so the list
    // behind it already shows the saved row. A fire-and-forget refetch can
    // lag on a slow connection and the page otherwise looks unchanged.
    // allSettled: a failed refetch must never strand the modal.
    onSuccess: async () => {
      await Promise.allSettled([
        qc.invalidateQueries({ queryKey: ['transactions'] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
        qc.invalidateQueries({ queryKey: ['accounts'] }),
      ]);
      onSaved();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.detail : 'Could not save the transaction.');
    },
  });

  const cats = useMemo(
    () => categories.filter((c) => c.type === form.type),
    [categories, form.type],
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    save.mutate();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex gap-2">
        {(['income', 'expense'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`btn flex-1 ${form.type === t ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setForm((f) => ({ ...f, type: t, category: '' }))}
          >
            {t === 'income' ? 'Income' : 'Expense'}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="tx-amount">Amount</label>
          <input
            id="tx-amount"
            className="input"
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="tx-date">Date</label>
          <input
            id="tx-date"
            className="input"
            type="date"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            required
          />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="tx-account">Account</label>
        <select
          id="tx-account"
          className="input"
          value={form.account}
          onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))}
          required
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currency})
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="tx-category">Category</label>
        <select
          id="tx-category"
          className="input"
          value={form.category}
          onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
        >
          <option value="">No category</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.parent ? `— ${c.name}` : c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="tx-merchant">Merchant / payee</label>
        <input
          id="tx-merchant"
          className="input"
          value={form.merchant}
          onChange={(e) => setForm((f) => ({ ...f, merchant: e.target.value }))}
          placeholder="e.g. BigBasket, Salary"
        />
      </div>
      <div>
        <label className="label" htmlFor="tx-notes">Notes (optional)</label>
        <textarea
          id="tx-notes"
          className="input"
          rows={2}
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        />
      </div>
      <FieldError message={error} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : initial ? 'Save changes' : 'Add transaction'}
        </button>
      </div>
    </form>
  );
}

function TransferForm({ accounts, onSaved, onCancel }: { accounts: Account[]; onSaved: () => void; onCancel: () => void }) {
  const [source, setSource] = useState(accounts[0] ? String(accounts[0].id) : '');
  const [dest, setDest] = useState(accounts[1] ? String(accounts[1].id) : '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: () =>
      api.post('/transfers/', {
        source_account: Number(source),
        destination_account: Number(dest),
        amount,
        date,
        note: note.trim(),
      }),
    onSuccess: async () => {
      await Promise.allSettled([
        qc.invalidateQueries({ queryKey: ['transactions'] }),
        qc.invalidateQueries({ queryKey: ['accounts'] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      onSaved();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.detail : 'Could not save the transfer.');
    },
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError('');
        save.mutate();
      }}
    >
      <p className="body-6" style={{ color: 'var(--muted)' }}>
        Moving money between your own accounts never counts as income or spending.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="tr-from">From</label>
          <select id="tr-from" className="input" value={source} onChange={(e) => setSource(e.target.value)} required>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="tr-to">To</label>
          <select id="tr-to" className="input" value={dest} onChange={(e) => setDest(e.target.value)} required>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="tr-amount">Amount</label>
          <input
            id="tr-amount"
            className="input"
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="tr-date">Date</label>
          <input id="tr-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="tr-note">Note (optional)</label>
        <input id="tr-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <FieldError message={error} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Make transfer'}
        </button>
      </div>
    </form>
  );
}

function RecurringSection({ accounts, categories }: { accounts: Account[]; categories: Category[] }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState('');
  const list = useQuery({
    queryKey: ['recurring'],
    queryFn: () => fetchAll<RecurringTransaction>('/recurring/'),
  });
  const generate = useMutation({
    mutationFn: () => api.post<{ created: number }>('/recurring/generate-all-due/', {}),
    // Wait for the refetch to land before showing the result, so the
    // lists behind it already show the generated rows. allSettled: a
    // failed refetch must never strand the notice.
    onSuccess: async (res) => {
      await Promise.allSettled([
        qc.invalidateQueries({ queryKey: ['recurring'] }),
        qc.invalidateQueries({ queryKey: ['transactions'] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      setNotice(
        `${res.created} transaction${res.created === 1 ? '' : 's'} generated from due templates.`,
      );
    },
  });
  const toggle = useMutation({
    mutationFn: (r: RecurringTransaction) =>
      api.patch(`/recurring/${r.id}/`, { is_active: !r.is_active }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['recurring'] }).catch(() => undefined);
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/recurring/${id}/`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['recurring'] }).catch(() => undefined);
    },
  });

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="title-4">Recurring transactions</h2>
        <div className="flex gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => generate.mutate()} disabled={generate.isPending}>
            {generate.isPending ? 'Generating…' : 'Generate due now'}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
            + New template
          </button>
        </div>
      </div>
      {notice ? (
        <p className="caption-4 mb-3" role="status" style={{ color: 'var(--good)' }}>
          {notice}
        </p>
      ) : null}
      {list.isError ? (
        <QueryError title="Could not load templates" onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <Spinner label="Loading templates…" />
      ) : !list.data || list.data.length === 0 ? (
        <p className="body-6 py-2" style={{ color: 'var(--muted)' }}>
          No recurring templates yet — e.g. monthly rent or salary. Due instances are
          generated on demand with “Generate due now”.
        </p>
      ) : (
        <ul className="flex flex-col divide-y" style={{ borderColor: 'var(--border)' }}>
          {list.data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 body-6">
              <div>
                <span className="font-medium">{r.merchant || 'Recurring'}</span>
                <span style={{ color: 'var(--muted)' }}>
                  {' '}· {r.frequency} · {fmtMoney(r.amount)} · next due {fmtDate(r.next_due)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`badge ${r.is_active ? 'badge-green' : 'badge-grey'}`}>
                  {r.is_active ? 'active' : 'paused'}
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggle.mutate(r)}>
                  {r.is_active ? 'Pause' : 'Resume'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    if (window.confirm('Delete this recurring template?')) remove.mutate(r.id);
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {showForm ? (
        <Modal title="New recurring template" onClose={() => setShowForm(false)}>
          <RecurringForm
            accounts={accounts}
            categories={categories}
            onSaved={() => setShowForm(false)}
            onCancel={() => setShowForm(false)}
          />
        </Modal>
      ) : null}
    </div>
  );
}

function RecurringForm({
  accounts,
  categories,
  onSaved,
  onCancel,
}: {
  accounts: Account[];
  categories: Category[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [amount, setAmount] = useState('');
  const [account, setAccount] = useState(accounts[0] ? String(accounts[0].id) : '');
  const [category, setCategory] = useState('');
  const [merchant, setMerchant] = useState('');
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('monthly');
  const [startDate, setStartDate] = useState(todayIso());
  const [error, setError] = useState('');
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      api.post('/recurring/', {
        type,
        amount,
        account: Number(account),
        category: category ? Number(category) : null,
        merchant: merchant.trim(),
        frequency,
        start_date: startDate,
        next_due: startDate,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['recurring'] }).catch(() => undefined);
      onSaved();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.detail : 'Could not save the template.');
    },
  });
  const cats = categories.filter((c) => c.type === type);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError('');
        save.mutate();
      }}
    >
      <div className="flex gap-2">
        {(['income', 'expense'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`btn flex-1 ${type === t ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => {
              setType(t);
              setCategory('');
            }}
          >
            {t === 'income' ? 'Income' : 'Expense'}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="rc-amount">Amount</label>
          <input id="rc-amount" className="input" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="rc-freq">Frequency</label>
          <select id="rc-freq" className="input" value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="rc-account">Account</label>
        <select id="rc-account" className="input" value={account} onChange={(e) => setAccount(e.target.value)} required>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="rc-category">Category</label>
        <select id="rc-category" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">No category</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="rc-merchant">Merchant / payee</label>
          <input id="rc-merchant" className="input" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="e.g. Rent" />
        </div>
        <div>
          <label className="label" htmlFor="rc-start">First due</label>
          <input id="rc-start" className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </div>
      </div>
      <FieldError message={error} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save template'}
        </button>
      </div>
    </form>
  );
}

export function TransactionsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [account, setAccount] = useState('');
  const [category, setCategory] = useState('');
  const [type, setType] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [adding, setAdding] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [deleting, setDeleting] = useState<Transaction | null>(null);

  const accountsQ = useQuery({ queryKey: ['accounts'], queryFn: () => fetchAll<Account>('/accounts/') });
  const categoriesQ = useQuery({ queryKey: ['categories'], queryFn: () => fetchAll<Category>('/categories/') });

  const queryString = useMemo(
    () => qs({ search, account, category, type, start, end, page }),
    [search, account, category, type, start, end, page],
  );
  const list = useQuery({
    queryKey: ['transactions', queryString],
    queryFn: () => api.get<Paginated<Transaction>>(`/transactions/${queryString}`),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/transactions/${id}/`),
    onSuccess: async () => {
      await Promise.allSettled([
        qc.invalidateQueries({ queryKey: ['transactions'] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
        qc.invalidateQueries({ queryKey: ['accounts'] }),
      ]);
      setDeleting(null);
    },
  });

  const accounts = accountsQ.data ?? [];
  const categories = categoriesQ.data ?? [];
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.count / 50)) : 1;

  function resetPage() {
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="heading-6">Transactions</h1>
          <p className="body-6" style={{ color: 'var(--muted)' }}>
            Income and expenses. Transfers are listed separately and never count
            as income or spending.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/import" className="btn btn-ghost">Import CSV</Link>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void api.download(`/transactions/export/${queryString}`, 'transactions.csv')}
          >
            Export CSV
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setTransferring(true)} disabled={accounts.length < 2}>
            Transfer
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)} disabled={accounts.length === 0}>
            + Add transaction
          </button>
        </div>
      </div>

      <div className="card flex flex-wrap gap-3 p-4">
        <input
          className="input min-w-40 flex-1"
          placeholder="Search merchant or notes…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); resetPage(); }}
        />
        <select className="input w-44" value={account} onChange={(e) => { setAccount(e.target.value); resetPage(); }}>
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <select className="input w-44" value={category} onChange={(e) => { setCategory(e.target.value); resetPage(); }}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
          ))}
        </select>
        <select className="input w-44" value={type} onChange={(e) => { setType(e.target.value); resetPage(); }}>
          <option value="">Income + expense</option>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
        </select>
        <input
          className="input w-40"
          type="date"
          aria-label="From date"
          value={start}
          onChange={(e) => { setStart(e.target.value); resetPage(); }}
        />
        <input
          className="input w-40"
          type="date"
          aria-label="To date"
          value={end}
          onChange={(e) => { setEnd(e.target.value); resetPage(); }}
        />
      </div>

      {list.isError ? (
        <QueryError title="Could not load transactions" onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <Spinner label="Loading transactions…" />
      ) : !list.data || list.data.results.length === 0 ? (
        <EmptyState
          art="transactions"
          title="No transactions match"
          hint={accounts.length === 0 ? 'Add an account first, then record your first transaction.' : 'Try clearing a filter, or add a transaction.'}
          action={
            accounts.length > 0 ? (
              <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
                + Add transaction
              </button>
            ) : (
              <Link to="/accounts" className="btn btn-primary">Add an account</Link>
            )
          }
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="table-head">Date</th>
                <th className="table-head">Merchant</th>
                <th className="table-head">Category</th>
                <th className="table-head">Account</th>
                <th className="table-head text-right">Amount</th>
                <th className="table-head" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {list.data.results.map((tx) => (
                <tr key={tx.id} className="hover:opacity-90" style={{ background: 'var(--surface)' }}>
                  <td className="table-cell whitespace-nowrap">{fmtDate(tx.date)}</td>
                  <td className="table-cell">
                    <p className="font-medium">{tx.merchant || '—'}</p>
                    {tx.notes ? (
                      <p className="max-w-64 truncate caption-5" style={{ color: 'var(--muted)' }}>{tx.notes}</p>
                    ) : null}
                  </td>
                  <td className="table-cell">{tx.category_name ?? '—'}</td>
                  <td className="table-cell">{tx.account_name}</td>
                  <td
                    className="table-cell text-right font-medium tabular-nums"
                    style={{ color: tx.type === 'income' ? 'var(--good)' : 'var(--danger)' }}
                  >
                    {tx.type === 'income' ? '+' : '−'}{fmtMoney(tx.amount)}
                  </td>
                  <td className="table-cell whitespace-nowrap text-right">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(tx)}>
                      Edit
                    </button>{' '}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(tx)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-4 py-3 body-6">
            <span style={{ color: 'var(--muted)' }}>
              {list.data.count} transaction(s) · page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button type="button" className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <IconChevronLeft size={16} /> Prev
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next <IconChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      <RecurringSection accounts={accounts} categories={categories} />

      {(adding || editing) ? (
        <Modal
          title={editing ? 'Edit transaction' : 'Add transaction'}
          onClose={() => { setAdding(false); setEditing(null); }}
        >
          <TransactionForm
            initial={editing}
            accounts={accounts}
            categories={categories}
            onSaved={() => { setAdding(false); setEditing(null); }}
            onCancel={() => { setAdding(false); setEditing(null); }}
          />
        </Modal>
      ) : null}

      {transferring ? (
        <Modal title="Transfer between accounts" onClose={() => setTransferring(false)}>
          <TransferForm
            accounts={accounts}
            onSaved={() => setTransferring(false)}
            onCancel={() => setTransferring(false)}
          />
        </Modal>
      ) : null}

      {deleting ? (
        <Modal title="Delete transaction?" onClose={() => setDeleting(null)}>
          <p className="body-6">
            Delete “{deleting.merchant || deleting.category_name || 'transaction'}” for{' '}
            {fmtMoney(deleting.amount)} on {fmtDate(deleting.date)}? Account balances
            update automatically.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-danger" onClick={() => remove.mutate(deleting.id)} disabled={remove.isPending}>
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
