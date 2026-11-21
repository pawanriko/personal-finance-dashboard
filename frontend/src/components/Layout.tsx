import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { initials } from '../lib/utils';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '▦', end: true },
  { to: '/transactions', label: 'Transactions', icon: '⇄' },
  { to: '/budgets', label: 'Budgets', icon: '◔' },
  { to: '/accounts', label: 'Accounts', icon: '▤' },
  { to: '/reports', label: 'Reports', icon: '▧' },
  { to: '/goals', label: 'Goals', icon: '◎' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
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
          className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white"
          style={{ background: 'var(--accent)' }}
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
            <p className="text-sm font-medium">{user.username}</p>
            <p className="truncate text-xs" style={{ color: 'var(--muted)' }}>
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

  return (
    <div className="flex min-h-screen">
      {/* Sidebar (desktop) */}
      <aside
        className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r p-4 md:flex"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="mb-6 px-2">
          <p className="text-base font-bold leading-tight">Personal Finance</p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Dashboard
          </p>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <p className="mt-auto px-2 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
          Money is stored as exact decimals. Transfers never count as income or
          spending.
        </p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header
          className="sticky top-0 z-40 flex items-center gap-2 border-b px-4 py-3"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <p className="text-sm font-semibold md:hidden">Personal Finance</p>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={toggle}
              className="btn btn-ghost btn-sm"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              {theme === 'dark' ? '☀ Light' : '☾ Dark'}
            </button>
            <ProfileMenu />
          </div>
        </header>

        {/* Mobile nav */}
        <nav
          className="flex gap-1 overflow-x-auto border-b px-3 py-2 md:hidden"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `nav-link shrink-0 ${isActive ? 'active' : ''}`
              }
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Page content — keyed by path so each navigation replays the
            subtle page transition. */}
        <main key={location.pathname} className="anim-page mx-auto w-full max-w-6xl flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
