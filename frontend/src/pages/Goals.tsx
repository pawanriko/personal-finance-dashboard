import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, fetchAll, qs, ApiError } from '../lib/api';
import type { Account, Goal, GoalContribution } from '../lib/types';
import { fmtDate, fmtMoney, todayIso } from '../lib/utils';
import { EmptyState, FieldError, Modal, ProgressBar, Spinner } from '../components/ui';

function GoalForm({
  initial,
  accounts,
  onSaved,
  onCancel,
}: {
  initial: Goal | null;
  accounts: Account[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [target, setTarget] = useState(initial?.target_amount ?? '');
  const [targetDate, setTargetDate] = useState(initial?.target_date ?? '');
  const [account, setAccount] = useState(initial?.account ? String(initial.account) : '');
  const [error, setError] = useState('');
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        target_amount: target,
        target_date: targetDate || null,
        account: account ? Number(account) : null,
      };
      if (initial) return api.patch<Goal>(`/goals/${initial.id}/`, payload);
      return api.post<Goal>('/goals/', payload);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['goals'] });
      onSaved();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.detail : 'Could not save the goal.');
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
        <label className="label" htmlFor="gl-name">Goal name</label>
        <input id="gl-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Emergency fund" required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="gl-target">Target amount</label>
          <input id="gl-target" className="input" type="number" min="0.01" step="0.01" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="gl-date">Target date (optional)</label>
          <input id="gl-date" className="input" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="gl-account">Account the savings sit in (optional)</label>
        <select id="gl-account" className="input" value={account} onChange={(e) => setAccount(e.target.value)}>
          <option value="">None</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
      <FieldError message={error} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : initial ? 'Save changes' : 'Add goal'}
        </button>
      </div>
    </form>
  );
}

function GoalDetail({ goal }: { goal: Goal }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const list = useQuery({
    queryKey: ['goal-contributions', goal.id],
    queryFn: () => fetchAll<GoalContribution>(`/goal-contributions/${qs({ goal: goal.id })}`),
  });
  const add = useMutation({
    mutationFn: () =>
      api.post('/goal-contributions/', { goal: goal.id, amount, date, note: note.trim() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['goal-contributions', goal.id] });
      void qc.invalidateQueries({ queryKey: ['goals'] });
      setAmount('');
      setNote('');
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.detail : 'Could not add the contribution.');
    },
  });
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-1 flex justify-between text-sm">
          <span>{fmtMoney(goal.current_amount)} saved</span>
          <span style={{ color: 'var(--muted)' }}>{goal.progress_percent}%</span>
        </div>
        <ProgressBar percent={goal.progress_percent} />
        <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
          {fmtMoney(goal.remaining_amount)} to go
          {goal.target_date ? ` · target ${fmtDate(goal.target_date)}` : ''}
          {goal.account_name ? ` · in ${goal.account_name}` : ''}
        </p>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setError('');
          add.mutate();
        }}
      >
        <div>
          <label className="label" htmlFor="gc-amount">Contribution</label>
          <input id="gc-amount" className="input w-36" type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="gc-date">Date</label>
          <input id="gc-date" className="input w-40" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div className="flex-1">
          <label className="label" htmlFor="gc-note">Note (optional)</label>
          <input id="gc-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={add.isPending}>
          {add.isPending ? 'Adding…' : 'Add'}
        </button>
      </form>
      <FieldError message={error} />
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        Contributions only track progress toward the target — they do not move
        money between accounts.
      </p>
      {list.isLoading ? (
        <Spinner label="Loading contributions…" />
      ) : !list.data || list.data.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>No contributions yet.</p>
      ) : (
        <ul className="flex flex-col divide-y text-sm" style={{ borderColor: 'var(--border)' }}>
          {list.data.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-2">
              <span>
                {fmtDate(c.date)}
                {c.note ? ` · ${c.note}` : ''}
              </span>
              <span className="font-medium tabular-nums">+{fmtMoney(c.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function GoalsPage() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [detail, setDetail] = useState<Goal | null>(null);
  const [deleting, setDeleting] = useState<Goal | null>(null);

  const accountsQ = useQuery({ queryKey: ['accounts'], queryFn: () => fetchAll<Account>('/accounts/') });
  const list = useQuery({ queryKey: ['goals'], queryFn: () => fetchAll<Goal>('/goals/') });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/goals/${id}/`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['goals'] });
      setDeleting(null);
      setDetail(null);
    },
  });

  const accounts = accountsQ.data ?? [];
  const goals = list.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Goals</h1>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Savings targets with a target amount and optional target date.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>+ Add goal</button>
      </div>

      {list.isLoading ? (
        <Spinner label="Loading goals…" />
      ) : goals.length === 0 ? (
        <EmptyState
          title="No savings goals yet"
          hint="Set a target — an emergency fund, a trip, a new laptop — and track contributions toward it."
          action={<button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>+ Add goal</button>}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {goals.map((g) => (
            <div key={g.id} className="card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{g.name}</p>
                  <p className="text-sm tabular-nums" style={{ color: 'var(--muted)' }}>
                    {fmtMoney(g.current_amount)} of {fmtMoney(g.target_amount)}
                    {g.target_date ? ` · by ${fmtDate(g.target_date)}` : ''}
                  </p>
                </div>
                <span className="text-sm font-medium tabular-nums">{g.progress_percent}%</span>
              </div>
              <div className="mt-3">
                <ProgressBar percent={g.progress_percent} />
              </div>
              <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
                {fmtMoney(g.remaining_amount)} remaining
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDetail(g)}>Contribute</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(g)}>Edit</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(g)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <Modal title="Add goal" onClose={() => setAdding(false)}>
          <GoalForm initial={null} accounts={accounts} onSaved={() => setAdding(false)} onCancel={() => setAdding(false)} />
        </Modal>
      ) : null}
      {editing ? (
        <Modal title={`Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <GoalForm initial={editing} accounts={accounts} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} />
        </Modal>
      ) : null}
      {detail ? (
        <Modal title={detail.name} wide onClose={() => setDetail(null)}>
          <GoalDetail goal={detail} />
        </Modal>
      ) : null}
      {deleting ? (
        <Modal title="Delete goal?" onClose={() => setDeleting(null)}>
          <p className="text-sm">
            Delete “{deleting.name}” (target {fmtMoney(deleting.target_amount)})? Its
            contributions are deleted with it.
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
