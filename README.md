# Personal Finance Dashboard

A personal finance dashboard: manual transaction entry, CSV import,
budgets, goals, and reports. Django + DRF backend, React frontend.

Spec: `your_files/personal-finance-dashboard/blueprint.md` (the blueprint
is authoritative for features and behaviour).

## Stack

- Python 3.12, Django 5.2, Django REST Framework 3.16
- React 19 + TypeScript + Vite, React Router, TanStack Query, Recharts,
  Tailwind CSS v4 (`frontend/`)
- PostgreSQL in production via `DATABASE_URL`; local SQLite by default
- No Celery/Redis in v1 (blueprint: skip until background tasks need them)

## Quick start (local)

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python manage.py migrate
.venv/bin/python manage.py createsuperuser
.venv/bin/python manage.py runserver
```

API base: `http://127.0.0.1:8000/api/`

### Frontend (React)

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173 (proxies /api to the backend)
```

See `frontend/README.md` for pages, the design system, and auth notes.

### With Docker Compose (backend + Postgres)

```bash
docker compose up --build
# in another shell:
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py createsuperuser
```

## Configuration

All secrets come from environment variables (see `.env.example`):

| Variable | Meaning |
| --- | --- |
| `DJANGO_SECRET_KEY` | Required in production; dev fallback is insecure |
| `DJANGO_DEBUG` | `true` by default locally |
| `DATABASE_URL` | `postgres://user:pass@host:port/db` — empty means local SQLite |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | Origins allowed to POST (default: Vite dev server on :5173) |
| `CSV_UPLOAD_MAX_BYTES` | Max CSV upload size (default 5 MB) |
| `INSFORGE_AUTH_ENABLED` | `true` turns on Google/GitHub sign-in (default `false`) |
| `INSFORGE_BASE_URL` | InsForge project URL, e.g. `https://<appkey>.us-east.insforge.app` |
| `VITE_INSFORGE_URL` | Same project URL, for the browser (build-time) |
| `VITE_INSFORGE_ANON_KEY` | InsForge anon/public key (browser-safe) |

## Google/GitHub sign-in (InsForge)

Optional — password login works without any of this. InsForge is used
only at login: the browser signs in against InsForge (Google or GitHub
OAuth) and the backend verifies the access token once, then starts a
normal Django session. The API itself stays session + CSRF only.

1. Create a **new** InsForge project for this app (do not reuse another
   app's project). In the InsForge console enable the **Google** and
   **GitHub** providers and add the allowed redirect URL
   `https://<app>.onrender.com/login` (plus `http://localhost:5173/login`
   for local dev).
2. On Render set `INSFORGE_BASE_URL`, `VITE_INSFORGE_URL` (same URL),
   `VITE_INSFORGE_ANON_KEY`, and flip `INSFORGE_AUTH_ENABLED` to
   `true` — the Vite vars must be set **before** the deploy that
   builds the frontend, or the buttons stay hidden.
3. Redeploy. The login and sign-up pages show "Continue with Google"
   and "Continue with GitHub". First OAuth sign-in creates the Django
   account automatically (username from the email, unusable password).
   If the email already belongs to a password account, the sign-in is
   refused (409) — sign in with the password instead; accounts are
   never linked silently.

Notes: a paused InsForge project (free tier, 1 week inactive) only
disables the OAuth buttons — password login keeps working. The
InsForge access token is verified once at login and never stored.

## Deployment (Render + Neon, free)

One Render Free web service serves Django + the built React SPA from a
single domain; the database is a Neon Free Postgres project. $0/month, no
card. `render.yaml` in the repo root is the Render blueprint.

1. **Neon:** create a project in Singapore (`aws-ap-southeast-1`), copy
   the **pooled** connection string (host contains `-pooler`, ends in
   `?sslmode=require`).
2. **Render:** New → Web Service → connect this repo → Environment
   Python, plan Free (or apply `render.yaml` as a Blueprint). Build:
   `pip install -r requirements.txt && npm ci --prefix frontend &&
   npm run build --prefix frontend && python manage.py collectstatic
   --noinput && python manage.py migrate`. Start: `gunicorn
   finance.wsgi:application --bind 0.0.0.0:$PORT`.
3. **Env vars on Render** (set in the dashboard, never commit them):

   | Variable | Value |
   | --- | --- |
   | `DJANGO_SECRET_KEY` | generated fresh in Render (`generateValue` in render.yaml) |
   | `DJANGO_DEBUG` | `false` |
   | `DATABASE_URL` | Neon pooled URL |
   | `DJANGO_ALLOWED_HOSTS` | `<app>.onrender.com` (fill in after the first deploy) |
   | `DJANGO_CSRF_TRUSTED_ORIGINS` | `https://<app>.onrender.com` |

   Session cookies are first-party on the single domain, so Django's
   default `SameSite=Lax` works — no CORS settings needed.
4. **Verify:** open `https://<app>.onrender.com`, register/login, add an
   entry, reload — data must persist (Neon).

Caveats: the free service sleeps after 15 idle minutes (~1-minute cold
start on the next request) — expected. **Do not add an uptime pinger:**
it would burn the 750 free instance-hours/month and push Neon past its
100 CU-hours/month, suspending the database. Uploaded CSVs live under
`media/` on Render's ephemeral filesystem and are lost on redeploy —
re-import if needed. Neon Free has no automated backups; take a
`pg_dump` regularly.

## Design decisions (from the blueprint)

**Amount convention.** Money is stored as `Decimal` (12 digits, 2 decimal
places), never float. Every amount is stored **positive**, with a separate
`type` field (`income` / `expense`). Transfers are a separate model: creating
one writes two linked transaction legs (out of the source account, into the
destination), flagged `is_transfer=True`, so moving money never inflates
income or spending in reports.

**Balances are computed, never stored.** `Account.balance()` =
opening balance + income − expenses over the transaction ledger. Edits and
deletes can never leave a stale total. For a credit card, a negative balance
means "amount owed" (spending pushes it negative; paying it off is a transfer
in, which brings it back toward zero).

**Auth: Django session auth + CSRF.** The blueprint recommends this for a
browser app instead of long-lived tokens in browser storage. The React
frontend reads the `csrftoken` cookie and sends it as the `X-CSRFToken`
header. Every API endpoint requires an authenticated session, and every
queryset is scoped to `request.user` — users can only ever see their own
data.

**Budgets are per-month and do not carry forward.** A budget applies to one
category in one month (`month` is always the 1st). Status is `ok` / `near`
(≥80% spent) / `over` (>100%).

**CSV import is preview → confirm.** Upload returns parsed rows with
per-row validation errors and likely-duplicate flags; confirming imports
only the valid, selected rows. Duplicates are detected by
(account, date, amount, merchant), and by (account, date, amount) as a
likely-duplicate fallback. Only `.csv` files up to 5 MB are accepted.

**Goal contributions track progress only.** Contributing to a goal records
progress toward the target; it does not move money between accounts (v1).

**Privacy.** No transaction details (amounts, merchants, notes) are ever
written to logs. Uploaded CSVs live under `media/imports/` (gitignored).

## Data model (`core` app)

| Model | Purpose |
| --- | --- |
| `Profile` | Per-user prefs (default currency, default `INR`) |
| `Account` | checking / savings / credit card / cash + opening balance |
| `Category` | income/expense, optional parent; 17 defaults seeded per user |
| `Transaction` | income/expense entry; `is_transfer` legs belong to a Transfer |
| `Transfer` | move between two same-currency accounts; legs auto-synced on save |
| `RecurringTransaction` | template (rent/salary) with frequency + `next_due` |
| `Budget` | monthly limit per expense category |
| `Goal` / `GoalContribution` | savings target + contributions |
| `CsvImport` | one upload session: file, mapping, parsed preview rows, status |

## Project layout

```
finance/        Django project (settings read DATABASE_URL; SQLite fallback)
core/           models, services (CSV + dashboard aggregates),
                serializers, views, urls, tests
manage.py
requirements.txt
docker-compose.yml   backend + Postgres (frontend service comes later)
Dockerfile
```

## API reference

Base: `/api/`. All endpoints require an authenticated session (except
`auth/csrf`, `auth/register`, `auth/login`). Money is returned as
2-decimal strings (e.g. `"120.50"`), never floats. Lists are paginated
(50 per page).

| Endpoint | What it does |
| --- | --- |
| `POST /api/auth/register/` | Create user (seeds 17 default categories) + log in |
| `POST /api/auth/login/` / `POST /api/auth/logout/` | Session login / logout |
| `GET /api/auth/me/` · `GET /api/auth/csrf/` | Current user · set the CSRF cookie |
| `GET,PATCH /api/profile/` | Default currency + user info |
| `GET,POST /api/accounts/` · `GET,PATCH,DELETE /api/accounts/{id}/` | Accounts; each carries computed `balance` |
| `GET /api/accounts/{id}/history/?start&end` | Account ledger incl. transfer legs |
| `GET,POST /api/categories/` · `POST /api/categories/seed-defaults/` | Categories (filter `?type=`, `?parent=null`); re-seed defaults |
| `GET,POST /api/transactions/` | List (filters: `account`, `category`, `type`, `start`, `end`, `search`; `include_transfers=true` to see transfer legs) · create |
| `GET,PATCH,DELETE /api/transactions/{id}/` · `GET /api/transactions/export/` | Edit/delete (balances update) · CSV download |
| `GET,POST /api/transfers/` · `GET,PATCH,DELETE /api/transfers/{id}/` | Move money; legs auto-synced, never income/spending |
| `GET,POST /api/recurring/` · `POST /api/recurring/{id}/generate-due/` · `POST /api/recurring/generate-all-due/` | Templates; generate due instances up to `up_to` (default today) |
| `GET,POST /api/budgets/` · `GET,PATCH,DELETE /api/budgets/{id}/` | Monthly limits; `spent`, `remaining`, `percent_used`, `status` (`ok`/`near`/`over`); filter `?month=YYYY-MM-01` |
| `GET,POST /api/goals/` · `GET,PATCH,DELETE /api/goals/{id}/` | Savings targets; `current_amount`, `remaining_amount`, `progress_percent` |
| `GET,POST /api/goal-contributions/` | Contributions (`?goal=` filter) |
| `POST /api/csv-imports/` | Upload CSV → preview (auto column mapping, per-row errors, duplicate flags) |
| `POST /api/csv-imports/{id}/confirm/` | Import valid selected rows (`selected: [row numbers]`, optional) |
| `GET /api/dashboard/?start&end` | Balances, income/expenses/net, previous-period comparison, spending by category, monthly series, recent transactions, budget progress |
| `GET /api/reports/?start&end` · `GET /api/reports/export/` | Same aggregates as JSON · report as CSV |

## Status

- ✅ Milestone 1: project scaffold, data model, migrations, Docker setup
- ✅ Milestone 2: full DRF API + 50-test suite (all passing)
- ✅ Milestone 3: React frontend — all blueprint screens wired to the API,
  session auth + CSRF, dark/light mode, CSV import with mapping + preview
- ✅ Milestone 4: deploy-ready — gunicorn + WhiteNoise + dj-database-url,
  Django serves the built SPA from one domain, `render.yaml` blueprint
  (Render Free + Neon Free Postgres, $0/month)
- ⏳ Later: UI direction pass on the frontend, then bank integrations
