/** API client for the Django backend.
 *
 * Auth is Django session auth + CSRF: the browser holds the session
 * cookie (HttpOnly) and the csrftoken cookie (readable). Every mutating
 * request sends the token as the X-CSRFToken header. All requests send
 * credentials so cookies travel with the Vite proxy (/api -> :8000).
 */
import type { Paginated } from './types';

const API_BASE = '/api';

export class ApiError extends Error {
  status: number;
  detail: string;
  fields: Record<string, string[]> | null;

  constructor(status: number, detail: string, fields: Record<string, string[]> | null = null) {
    super(detail);
    this.status = status;
    this.detail = detail;
    this.fields = fields;
  }
}

function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const isForm = options.body instanceof FormData;
  const headers = new Headers(options.headers);
  if (!isForm && options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  const method = (options.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    const token = getCsrfToken();
    if (token) headers.set('X-CSRFToken', token);
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    let fields: Record<string, string[]> | null = null;
    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      if (typeof obj.detail === 'string') detail = obj.detail;
      else if (typeof obj.non_field_errors === 'object' && Array.isArray(obj.non_field_errors)) {
        detail = String(obj.non_field_errors[0]);
      }
      const fieldErrors: Record<string, string[]> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
          fieldErrors[key] = value as string[];
        }
      }
      if (Object.keys(fieldErrors).length > 0) {
        fields = fieldErrors;
        const first = Object.entries(fieldErrors)[0];
        detail = `${first[0]}: ${first[1][0]}`;
      }
    }
    throw new ApiError(res.status, detail, fields);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  postForm: <T>(path: string, form: FormData) =>
    request<T>(path, { method: 'POST', body: form }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),

  /** Download a CSV (or any blob) response with the same session auth. */
  download: async (path: string, filename: string) => {
    const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
    if (!res.ok) throw new ApiError(res.status, `Download failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

/** Follow DRF pagination (`next` links) and return every result. */
export async function fetchAll<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = path;
  while (url) {
    const page: Paginated<T> = await api.get<Paginated<T>>(url);
    out.push(...page.results);
    // `next` is an absolute backend URL; strip it back to a path so the
    // Vite proxy (and its cookies) still apply.
    url = page.next ? new URL(page.next).pathname + new URL(page.next).search : null;
  }
  return out;
}

/** Build a query string, skipping empty values. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}
