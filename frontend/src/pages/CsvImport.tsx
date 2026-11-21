import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, fetchAll, ApiError } from '../lib/api';
import type { Account, CsvImport } from '../lib/types';
import { fmtDate } from '../lib/utils';
import { FieldError, Spinner } from '../components/ui';

const CSV_FIELDS = ['date', 'amount', 'type', 'merchant', 'category', 'notes'] as const;

export function CsvImportPage() {
  const qc = useQueryClient();
  const [account, setAccount] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvImport | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);

  const accountsQ = useQuery({ queryKey: ['accounts'], queryFn: () => fetchAll<Account>('/accounts/') });
  const historyQ = useQuery({ queryKey: ['csv-imports'], queryFn: () => fetchAll<CsvImport>('/csv-imports/') });

  const accounts = accountsQ.data ?? [];
  const headers = useMemo(
    () => (preview && preview.rows.length > 0 ? Object.keys(preview.rows[0].data) : []),
    [preview],
  );

  const upload = useMutation({
    mutationFn: async (withMapping: Record<string, string> | null) => {
      if (!file || !account) throw new Error('Choose an account and a CSV file.');
      const form = new FormData();
      form.append('file', file);
      form.append('account', account);
      if (withMapping) form.append('mapping', JSON.stringify(withMapping));
      return api.postForm<CsvImport>('/csv-imports/', form);
    },
    onSuccess: async (data) => {
      setPreview(data);
      setMapping(data.mapping);
      setSelected(new Set(data.rows.filter((r) => r.selected).map((r) => r.row)));
      setResult(null);
      setError('');
      await qc.invalidateQueries({ queryKey: ['csv-imports'] }).catch(() => undefined);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.detail : 'Upload failed.');
    },
  });

  const confirm = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error('No preview to confirm.');
      return api.post<{ created: number; skipped: number }>(`/csv-imports/${preview.id}/confirm/`, {
        selected: [...selected],
      });
    },
    onSuccess: async (res) => {
      setResult(res);
      await Promise.allSettled([
        qc.invalidateQueries({ queryKey: ['csv-imports'] }),
        qc.invalidateQueries({ queryKey: ['transactions'] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
        qc.invalidateQueries({ queryKey: ['accounts'] }),
      ]);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.detail : 'Import failed.');
    },
  });

  function startUpload(e: FormEvent) {
    e.preventDefault();
    setError('');
    upload.mutate(null);
  }

  function reparse() {
    setError('');
    upload.mutate(mapping);
  }

  function toggleRow(rowNo: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rowNo)) next.delete(rowNo);
      else next.add(rowNo);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="heading-6">Import CSV</h1>
        <p className="body-6" style={{ color: 'var(--muted)' }}>
          Upload → preview with column mapping → confirm. Rows with errors or
          likely duplicates are never imported unless you explicitly select them
          (duplicates stay blocked).
        </p>
      </div>

      {result ? (
        <div className="card p-4">
          <p className="font-medium">Import complete</p>
          <p className="body-6" style={{ color: 'var(--muted)' }}>
            {result.created} transaction(s) created, {result.skipped} skipped.
          </p>
          <button
            type="button"
            className="btn btn-primary mt-3"
            onClick={() => {
              setPreview(null);
              setResult(null);
              setFile(null);
            }}
          >
            Import another file
          </button>
        </div>
      ) : null}

      {!preview ? (
        <form className="card flex flex-col gap-4 p-4" onSubmit={startUpload}>
          <div>
            <label className="label" htmlFor="imp-account">Account for these transactions</label>
            <select
              id="imp-account"
              className="input"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              required
            >
              <option value="">Choose an account…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="imp-file">CSV file (max 5 MB, UTF-8)</label>
            <input
              id="imp-file"
              className="input"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          </div>
          <FieldError message={error} />
          <div>
            <button type="submit" className="btn btn-primary" disabled={upload.isPending || !file || !account}>
              {upload.isPending ? 'Parsing…' : 'Upload & preview'}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="title-4">
                Preview: {preview.file_name} · {preview.rows.length} row(s) ·{' '}
                {preview.valid_count} valid · {preview.error_count} with errors ·{' '}
                {preview.duplicate_count} likely duplicate(s)
              </h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setPreview(null); setFile(null); }}>
                Choose a different file
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {CSV_FIELDS.map((field) => (
                <div key={field}>
                  <label className="label" htmlFor={`map-${field}`}>
                    {field === 'date' || field === 'amount' ? `${field} (required)` : field}
                  </label>
                  <select
                    id={`map-${field}`}
                    className="input"
                    value={mapping[field] ?? ''}
                    onChange={(e) =>
                      setMapping((m) => ({ ...m, [field]: e.target.value }))
                    }
                  >
                    <option value="">— not mapped —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>
              Change a mapping and press “Re-parse” to re-read the file with the new
              columns. Amounts with a minus sign or (parentheses) are treated as
              expenses when no type column is mapped.
            </p>
            <div className="mt-3">
              <button type="button" className="btn btn-ghost btn-sm" onClick={reparse} disabled={upload.isPending}>
                {upload.isPending ? 'Re-parsing…' : 'Re-parse with this mapping'}
              </button>
            </div>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="table-head">Import?</th>
                  <th className="table-head">Row</th>
                  <th className="table-head">Date</th>
                  <th className="table-head">Merchant</th>
                  <th className="table-head">Category</th>
                  <th className="table-head">Type</th>
                  <th className="table-head text-right">Amount</th>
                  <th className="table-head">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => {
                  const blocked = row.errors.length > 0 || row.is_duplicate;
                  return (
                    <tr key={row.row}>
                      <td className="table-cell">
                        <input
                          type="checkbox"
                          checked={selected.has(row.row)}
                          disabled={blocked}
                          onChange={() => toggleRow(row.row)}
                          aria-label={`Import row ${row.row}`}
                        />
                      </td>
                      <td className="table-cell">{row.row}</td>
                      <td className="table-cell whitespace-nowrap">{fmtDate(row.parsed.date ?? '')}</td>
                      <td className="table-cell">{row.parsed.merchant || '—'}</td>
                      <td className="table-cell">{row.parsed.category || '—'}</td>
                      <td className="table-cell">{row.parsed.type ?? '—'}</td>
                      <td className="table-cell text-right tabular-nums">{row.parsed.amount ?? '—'}</td>
                      <td className="table-cell">
                        {row.errors.length > 0 ? (
                          <span className="badge badge-red">{row.errors.join('; ')}</span>
                        ) : row.is_duplicate ? (
                          <span className="badge badge-amber">likely duplicate</span>
                        ) : (
                          <span className="badge badge-green">valid</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <FieldError message={error} />
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => confirm.mutate()}
              disabled={confirm.isPending || selected.size === 0}
            >
              {confirm.isPending ? 'Importing…' : `Import ${selected.size} selected row(s)`}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => { setPreview(null); setFile(null); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="card p-4">
        <h2 className="title-4 mb-2">Past imports</h2>
        {historyQ.isLoading ? (
          <Spinner label="Loading imports…" />
        ) : !historyQ.data || historyQ.data.length === 0 ? (
          <p className="body-6" style={{ color: 'var(--muted)' }}>No imports yet.</p>
        ) : (
          <ul className="flex flex-col divide-y text-sm" style={{ borderColor: 'var(--border)' }}>
            {historyQ.data.map((imp) => (
              <li key={imp.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {imp.file_name} · {fmtDate(imp.created_at.slice(0, 10))}
                </span>
                <span style={{ color: 'var(--muted)' }}>
                  {imp.status} · {imp.created_count} created · {imp.skipped_count} skipped
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
