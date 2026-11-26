import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiError } from './api';
import { queryClient } from './queryClient';
import type { User } from './types';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  providers: string[];
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  startOAuth: (provider: 'google' | 'github') => Promise<void>;
  passwordReset: (email: string) => Promise<string>;
  passwordResetConfirm: (uid: string, token: string, password: string) => Promise<string>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  loading: true,
  providers: [],
  login: async () => {},
  register: async () => {},
  startOAuth: async () => {},
  passwordReset: async () => '',
  passwordResetConfirm: async () => '',
  logout: async () => {},
  refresh: async () => {},
});

function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<string[]>([]);

  async function refresh() {
    try {
      // Touch the CSRF endpoint first so the cookie exists for the
      // session check and any later mutating request.
      const csrf = await api.get<{ providers?: string[] }>('/auth/csrf/');
      setProviders(csrf.providers ?? []);
      const me = await api.get<User>('/auth/me/');
      setUser(me);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setUser(null);
      } else {
        // Network/backend down: stay logged out rather than spinning.
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(username: string, password: string) {
    await api.get('/auth/csrf/');
    const me = await api.post<User>('/auth/login/', { username, password });
    setUser(me);
  }

  async function register(username: string, email: string, password: string) {
    await api.get('/auth/csrf/');
    const me = await api.post<User>('/auth/register/', { username, email, password });
    setUser(me);
  }

  async function startOAuth(provider: 'google' | 'github') {
    await api.get('/auth/csrf/');
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = `/accounts/${provider}/login/`;
    const csrf = document.createElement('input');
    csrf.type = 'hidden';
    csrf.name = 'csrfmiddlewaretoken';
    csrf.value = getCsrfToken() ?? '';
    form.appendChild(csrf);
    const next = document.createElement('input');
    next.type = 'hidden';
    next.name = 'next';
    next.value = '/';
    form.appendChild(next);
    document.body.appendChild(form);
    form.submit();
  }

  async function passwordReset(email: string) {
    await api.get('/auth/csrf/');
    const data = await api.post<{ detail: string }>('/auth/password-reset/', { email });
    return data.detail;
  }

  async function passwordResetConfirm(uid: string, token: string, password: string) {
    await api.get('/auth/csrf/');
    const data = await api.post<{ detail: string }>('/auth/password-reset/confirm/', {
      uid,
      token,
      password,
    });
    return data.detail;
  }

  async function logout() {
    try {
      await api.post('/auth/logout/', {});
    } catch {
      // Even if the call fails, drop the local session state.
    }
    setUser(null);
    // Drop every cached query: the next login must not flash the previous
    // user's lists while its own refetch is in flight.
    queryClient.clear();
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        providers,
        login,
        register,
        startOAuth,
        passwordReset,
        passwordResetConfirm,
        logout,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthCtx {
  return useContext(AuthContext);
}
