import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, fetchAll, qs, ApiError } from '../lib/api';
import type { Category, Profile } from '../lib/types';
import { useAuth } from '../lib/auth';
import { FieldError, Modal, Spinner } from '../components/ui';

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'SGD'];

function CategoryForm({
  initial,
  categories,
  onSaved,
  onCancel,
}: {
  initial: Category | null;
  categories: Category[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<'income' | 'expense'>(initial?.type ?? 'expense');
  const [parent, setParent] = useState(initial?.parent ? String(initial.parent) : '');
  const [error, setError] = useState('');
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => {
      const payload = { name: name.trim(), type, parent: parent ? Number(parent) : null };
      if (initial) return api.patch<Category>(`/categories/${initial.id}/`, payload);
      return api.post<Category>('/categories/', payload);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['categories'] }).catch(() => undefined);
      onSaved();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.detail : 'Could not save the category.');
    },
  });
  const parents = categories.filter(
    (c) => c.type === type && c.parent === null && c.id !== initial?.id,
  );
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
        <label className="label" htmlFor="ct-name">Name</label>
        <input id="ct-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="ct-type">Type</label>
          <select
            id="ct-type"
            className="input"
            value={type}
            onChange={(e) => {
              setType(e.target.value as 'income' | 'expense');
              setParent('');
            }}
          >
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ct-parent">Parent (optional)</label>
          <select id="ct-parent" className="input" value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">No parent</option>
            {parents.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>
      <FieldError message={error} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : initial ? 'Save changes' : 'Add category'}
        </button>
      </div>
    </form>
  );
}

export function SettingsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [currency, setCurrency] = useState('');
  const [saved, setSaved] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);

  const profileQ = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<Profile>('/profile/'),
  });
  const categoriesQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => fetchAll<Category>('/categories/'),
  });

  const saveProfile = useMutation({
    mutationFn: () => api.patch<Profile>('/profile/', { default_currency: currency }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['profile'] }).catch(() => undefined);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    },
  });
  const seed = useMutation({
    mutationFn: () => api.post<{ default_categories: number }>('/categories/seed-defaults/', {}),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['categories'] }).catch(() => undefined);
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/categories/${id}/`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['categories'] }).catch(() => undefined);
      setDeleting(null);
    },
  });

  const categories = categoriesQ.data ?? [];
  const incomeCats = categories.filter((c) => c.type === 'income');
  const expenseCats = categories.filter((c) => c.type === 'expense');
  const currentCurrency = currency || profileQ.data?.default_currency || 'INR';

  function categoryRow(c: Category) {
    return (
      <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
        <span>
          {c.parent ? '— ' : ''}
          {c.name}
          {c.is_default ? <span className="badge badge-grey ml-2">default</span> : null}
        </span>
        <span className="flex gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(c)}>Edit</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(c)}>Delete</button>
        </span>
      </li>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="heading-6">Settings</h1>
        <p className="body-6" style={{ color: 'var(--muted)' }}>
          Profile, default currency, categories, and your data.
        </p>
      </div>

      <div className="card p-4">
        <h2 className="title-4 mb-3">Profile</h2>
        {profileQ.isLoading ? (
          <Spinner label="Loading profile…" />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Username</label>
                <p className="text-sm font-medium">{user?.username}</p>
              </div>
              <div>
                <label className="label">Email</label>
                <p className="text-sm font-medium">{user?.email || '—'}</p>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="set-currency">Default currency for new accounts</label>
              <div className="flex gap-2">
                <select
                  id="set-currency"
                  className="input w-40"
                  value={currentCurrency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saveProfile.isPending || currentCurrency === profileQ.data?.default_currency}
                  onClick={() => saveProfile.mutate()}
                >
                  {saveProfile.isPending ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="title-4">Categories</h2>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => seed.mutate()} disabled={seed.isPending}>
              {seed.isPending ? 'Seeding…' : 'Re-seed defaults'}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
              + Add category
            </button>
          </div>
        </div>
        {categoriesQ.isLoading ? (
          <Spinner label="Loading categories…" />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="caption-4 mb-1" style={{ color: 'var(--muted)' }}>
                Income
              </h3>
              <ul className="flex flex-col divide-y" style={{ borderColor: 'var(--border)' }}>
                {incomeCats.map(categoryRow)}
              </ul>
            </div>
            <div>
              <h3 className="caption-4 mb-1" style={{ color: 'var(--muted)' }}>
                Expense
              </h3>
              <ul className="flex flex-col divide-y" style={{ borderColor: 'var(--border)' }}>
                {expenseCats.map(categoryRow)}
              </ul>
            </div>
          </div>
        )}
        <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>
          Deleting a category leaves its transactions uncategorised. Deleting a
          parent category also deletes its sub-categories.
        </p>
      </div>

      <div className="card p-4">
        <h2 className="title-4 mb-3">Your data</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void api.download('/transactions/export/', 'transactions.csv')}
          >
            Export all transactions (CSV)
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() =>
              void api.download(`/reports/export/${qs({})}`, 'report.csv')
            }
          >
            Export this month’s report (CSV)
          </button>
        </div>
        <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>
          Your data is yours: export it any time. Deleting the whole account
          (user + all data) is not wired to an API endpoint yet — that is a
          backend gap to close before launch, not something the UI fakes.
        </p>
      </div>

      {adding ? (
        <Modal title="Add category" onClose={() => setAdding(false)}>
          <CategoryForm initial={null} categories={categories} onSaved={() => setAdding(false)} onCancel={() => setAdding(false)} />
        </Modal>
      ) : null}
      {editing ? (
        <Modal title={`Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <CategoryForm initial={editing} categories={categories} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} />
        </Modal>
      ) : null}
      {deleting ? (
        <Modal title="Delete category?" onClose={() => setDeleting(null)}>
          <p className="text-sm">
            Delete “{deleting.name}” ({deleting.type})? Its transactions become
            uncategorised{deleting.children.length > 0 ? `, and its ${deleting.children.length} sub-categor(ies) are deleted too` : ''}.
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
