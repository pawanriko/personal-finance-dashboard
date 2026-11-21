# Personal Finance Dashboard — Frontend

React + TypeScript + Vite frontend for the Django backend in this repo.
Wired to the real API — no mock data anywhere.

## Stack

- React 19 + TypeScript, Vite 8
- React Router (pages), TanStack Query (data fetching/caching), Recharts (charts)
- Tailwind CSS v4 (design tokens in `src/index.css`; class-based dark mode)

## Run locally

```bash
# 1. Backend first (from the repo root):
.venv/bin/python manage.py migrate
.venv/bin/python manage.py runserver   # http://127.0.0.1:8000

# 2. Frontend (from this folder):
npm install
npm run dev                            # http://localhost:5173
```

The Vite dev server proxies `/api` and `/media` to the Django backend on
port 8000, so Django session cookies + CSRF work exactly as in production.
The backend's `CSRF_TRUSTED_ORIGINS` already includes `http://localhost:5173`.

Production build: `npm run build` (output in `dist/`).

## Production (Render, single domain)

In production the React app is **not** served by Vite: the Render build
step runs `npm run build`, Django collects `dist/` via WhiteNoise and
serves `dist/index.html` for every non-API path (catch-all in
`finance/urls.py`), so React Router works on refresh and deep links.
`src/lib/api.ts` uses relative `/api` paths — no `VITE_API_URL` needed —
so the built SPA talks to the same domain it was served from. See the
root README's "Deployment" section for the full setup.

## Pages (all wired to the API)

| Route | Screen | API used |
| --- | --- | --- |
| `/login`, `/register` | Sign in / sign up (session auth) | `auth/login/`, `auth/register/`, `auth/csrf/`, `auth/me/` |
| `/` | Dashboard — balances, cash flow, budgets, recent activity | `dashboard/` |
| `/transactions` | List + search/filters, add/edit, transfers, recurring templates | `transactions/`, `transfers/`, `recurring/` |
| `/import` | CSV import: upload → column mapping → preview → confirm | `csv-imports/` |
| `/budgets` | Monthly limits with spent/remaining/status | `budgets/` |
| `/accounts` | Accounts + balances, per-account history | `accounts/`, `accounts/{id}/history/` |
| `/reports` | Date-range summaries, charts, CSV export | `reports/`, `reports/export/` |
| `/goals` | Savings targets + contributions | `goals/`, `goal-contributions/` |
| `/settings` | Profile (default currency), categories, data export | `profile/`, `categories/` |

## Design system

One set of styles reused on every page (`src/index.css`): `.btn` /
`.btn-primary` / `.btn-ghost` / `.btn-danger`, `.card`, `.input`, `.label`,
`.badge`, `.nav-link`, table styles. Light/dark tokens live in `:root` /
`.dark`; the topbar toggle persists the choice in `localStorage`
(`pfd-theme`). Animations are fast and subtle: page fade-slide on
navigation, modal scale+fade pop-in (and pop-out on close), button press
scale. No decorative gradients or stock imagery — the polish is
consistency, spacing, and motion.

## Auth notes

- Session auth + CSRF: `src/lib/api.ts` reads the `csrftoken` cookie and
  sends it as `X-CSRFToken` on every mutating request, with
  `credentials: 'include'` on all requests.
- Money is returned by the API as 2-decimal strings and stays a string
  until display (`src/lib/utils.ts` formats it); no floats anywhere.
- Lists from DRF are paginated (50/page); `fetchAll` in `src/lib/api.ts`
  follows `next` links where a page needs the whole list.

## Known gaps (backend, not faked in the UI)

- There is no API endpoint to delete the whole user account (user + all
  data). Settings says so plainly instead of pretending the button works.
