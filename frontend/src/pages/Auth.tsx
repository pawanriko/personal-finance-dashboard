import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { insforgeSignInWithOAuth, isInsforgeConfigured } from '../lib/insforge';
import { FieldError, TaglineReveal } from '../components/ui';

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="auth-bg flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-2xl text-2xl font-bold shadow-lg"
            style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
            aria-hidden
          >
            ₹
          </span>
          <p className="title-5" style={{ color: 'var(--muted)' }}>
            Personal Finance
          </p>
        </div>
        <div className="card anim-page w-full p-6 shadow-lg">
          <h1 className="heading-6 hero-text">{title}</h1>
          <p className="body-6 mt-1" style={{ color: 'var(--muted)' }}>
            {subtitle}
          </p>
          <div className="mt-6">{children}</div>
        </div>
        {/* Tagline reveal (skill B11): the app's core benefit, below
            the card — the entry surface's one quiet statement. */}
        <div className="mt-8 flex justify-center px-2">
          <TaglineReveal
            lines={['Know where every rupee goes.', 'Spend with a clear head.']}
          />
        </div>
      </div>
    </div>
  );
}

/** Google "G" mark (official 4-colour artwork). */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z" />
      <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z" />
      <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z" />
      <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z" />
    </svg>
  );
}

/** GitHub mark (simple-icons path, verified against the published SVG). */
function GitHubMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

/** Google/GitHub sign-in buttons (InsForge OAuth). Hidden entirely
 * until the InsForge env vars are set at build time — with them unset
 * the app works exactly as before on username + password. */
function OAuthButtons({
  disabled,
  onError,
}: {
  disabled: boolean;
  onError: (message: string) => void;
}) {
  const [busyProvider, setBusyProvider] = useState<'google' | 'github' | null>(null);
  if (!isInsforgeConfigured()) return null;

  async function start(provider: 'google' | 'github') {
    setBusyProvider(provider);
    try {
      await insforgeSignInWithOAuth(provider);
      // The browser leaves for the provider here; the lines below
      // only run if the redirect never happens.
    } catch (err) {
      onError(err instanceof Error ? err.message : 'OAuth sign-in failed.');
    } finally {
      setBusyProvider(null);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="btn btn-ghost w-full"
          disabled={disabled || busyProvider !== null}
          onClick={() => void start('google')}
        >
          <GoogleMark />
          {busyProvider === 'google'
            ? 'Redirecting to Google…'
            : 'Continue with Google'}
        </button>
        <button
          type="button"
          className="btn btn-ghost w-full"
          disabled={disabled || busyProvider !== null}
          onClick={() => void start('github')}
        >
          <GitHubMark />
          {busyProvider === 'github'
            ? 'Redirecting to GitHub…'
            : 'Continue with GitHub'}
        </button>
      </div>
      <div className="my-4 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1" style={{ background: 'var(--border)' }} />
        <span className="caption-5" style={{ color: 'var(--muted)' }}>
          or continue with
        </span>
        <span className="h-px flex-1" style={{ background: 'var(--border)' }} />
      </div>
    </>
  );
}

export function LoginPage() {
  const { user, login, insforgeLogin } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);

  // Google/GitHub callback: InsForge redirects back here with
  // ?insforge_code=... — exchange it for a Django session.
  useEffect(() => {
    if (!searchParams.has('insforge_code')) return;
    // Drop the code from the URL first so a reload never replays it.
    window.history.replaceState(null, '', '/login');
    setOauthBusy(true);
    insforgeLogin()
      .then(() => navigate('/', { replace: true }))
      .catch((err: unknown) => {
        setError(
          err instanceof ApiError
            ? err.detail
            : err instanceof Error
              ? err.message
              : 'Google/GitHub sign-in failed.',
        );
      })
      .finally(() => setOauthBusy(false));
    // Run once on mount — the code param is consumed above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (user) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Login failed. Is the backend running?');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Welcome back" subtitle="Log in to your finance dashboard.">
      <OAuthButtons disabled={busy || oauthBusy} onError={setError} />
      {oauthBusy && (
        <p className="mb-4 text-center body-6" style={{ color: 'var(--muted)' }}>
          Completing your Google/GitHub sign-in…
        </p>
      )}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="login-username">Username</label>
          <input
            id="login-username"
            className="input"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="login-password">Password</label>
          <input
            id="login-password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <FieldError message={error} />
        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className="body-6 mt-4 text-center" style={{ color: 'var(--muted)' }}>
        No account yet?{' '}
        <Link to="/register" className="font-medium" style={{ color: 'var(--accent)' }}>
          Sign up
        </Link>
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await register(username.trim(), email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Sign up failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Your 17 default categories are set up automatically."
    >
      <OAuthButtons disabled={busy} onError={setError} />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="reg-username">Username</label>
          <input
            id="reg-username"
            className="input"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="reg-email">Email (optional)</label>
          <input
            id="reg-email"
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="reg-password">Password (at least 8 characters)</label>
          <input
            id="reg-password"
            className="input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
        <FieldError message={error} />
        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {busy ? 'Creating account…' : 'Sign up'}
        </button>
      </form>
      <p className="body-6 mt-4 text-center" style={{ color: 'var(--muted)' }}>
        Already have an account?{' '}
        <Link to="/login" className="font-medium" style={{ color: 'var(--accent)' }}>
          Log in
        </Link>
      </p>
    </AuthShell>
  );
}
