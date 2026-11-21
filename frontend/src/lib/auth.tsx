import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiError } from './api';
import type { User } from './types';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  loading: true,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      // Touch the CSRF endpoint first so the cookie exists for the
      // session check and any later mutating request.
      await api.get('/auth/csrf/');
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

  async function logout() {
    try {
      await api.post('/auth/logout/', {});
    } catch {
      // Even if the call fails, drop the local session state.
    }
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthCtx {
  return useContext(AuthContext);
}
