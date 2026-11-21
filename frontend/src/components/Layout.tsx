import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { playThemeRipple } from '../lib/themeRipple';
import { initials } from '../lib/utils';
import {
  IconAccounts,
  IconBudgets,
  IconDashboard,
  IconGoals,
  IconReports,
  IconSettings,
  IconTransactions,
} from './icons';

/* Nav icons are clean inline SVGs (see components/icons.tsx) — one
   consistent stroke set. */
const NAV: { to: string; label: string; icon: ReactNode; end?: boolean }[] = [
  { to: '/', label: 'Dashboard', icon: <IconDashboard size={16} />, end: true },
  { to: '/transactions', label: 'Transactions', icon: <IconTransactions size={16} /> },
  { to: '/budgets', label: 'Budgets', icon: <IconBudgets size={16} /> },
  { to: '/accounts', label: 'Accounts', icon: <IconAccounts size={16} /> },
  { to: '/reports', label: 'Reports', icon: <IconReports size={16} /> },
  { to: '/goals', label: 'Goals', icon: <IconGoals size={16} /> },
  { to: '/settings', label: 'Settings', icon: <IconSettings size={16} /> },
];

function ProfileMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!user) return null;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="btn btn-ghost btn-sm gap-2"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span
          className="flex h-8 w-8 items-center justify-center rounded-full caption-3"
          style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
        >
          {initials(user.username)}
        </span>
        <span className="hidden sm:inline">{user.username}</span>
      </button>
      {open ? (
        <div
          className="card anim-menu absolute right-0 z-50 mt-2 w-56 p-2 shadow-lg"
          role="menu"
        >
          <div className="border-b px-3 py-2" style={{ borderColor: 'var(--border)' }}>
            <p className="body-5">{user.username}</p>
            <p className="caption-5 truncate" style={{ color: 'var(--muted)' }}>
              {user.email || 'No email set'}
            </p>
          </div>
          <button
            type="button"
            className="nav-link w-full text-left"
            onClick={() => {
              setOpen(false);
              navigate('/settings');
            }}
          >
            Profile &amp; settings
          </button>
          <button
            type="button"
            className="nav-link w-full text-left"
            // Await the logout POST before navigating: /login bounces back
            // to / while `user` is still set, which made one logout click
            // look like it did nothing.
            onClick={async () => {
              setOpen(false);
              await logout();
              navigate('/login');
            }}
          >
            Log out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Layout() {
  const { theme, toggle } = useTheme();
  const location = useLocation();

  // Round theme toggle + water ripple: the new theme spreads from the
  // button's centre across the page (both directions).
  const onToggleTheme = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    playThemeRipple(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      toggle,
    );
  };

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      {/* Top bar (v2): HireSense-style — big wordmark, horizontal nav,
          theme toggle + profile at the top-right. No sidebar, no rupee logo. */}
      <header
        className="sticky top-0 z-40 border-b shadow-sm"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <NavLink to="/" end className="topbar-wordmark" aria-label="Personal Finance — home">
            Personal Finance
          </NavLink>
          <nav
            className="blur-siblings topbar-nav order-3 flex w-full gap-1 overflow-x-auto md:order-none md:w-auto md:flex-1 md:justify-center"
            aria-label="Primary"
          >
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `nav-link topbar-nav-link shrink-0 ${isActive ? 'active' : ''}`
                }
              >
                <span aria-hidden>{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleTheme}
              className="btn btn-ghost h-10 w-10 rounded-full p-0 text-base"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
            <ProfileMenu />
          </div>
        </div>
      </header>

      {/* Page content — keyed by path so each navigation replays the
          subtle page transition. */}
      <main
        id="main-content"
        key={location.pathname}
        className="anim-page mx-auto w-full max-w-6xl flex-1 p-4 md:p-6"
      >
        <Outlet />
      </main>
    </div>
  );
}
