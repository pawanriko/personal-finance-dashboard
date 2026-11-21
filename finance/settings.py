"""
Django settings for the Personal Finance Dashboard backend.

Secrets come from environment variables only. DATABASE_URL (a postgres://
URL, e.g. Neon) switches the database to PostgreSQL via dj-database-url;
when it is empty the project uses a local SQLite file, exactly like the
kai-v2 project.

Deploy target: one Render Free web service serving Django + the built
React SPA from a single domain (see render.yaml + README "Deployment").
"""

import os
from pathlib import Path

import dj_database_url

BASE_DIR = Path(__file__).resolve().parent.parent

# SECURITY WARNING: keep the secret key used in production secret!
# The fallback below is a dev-only key for running the project locally.
SECRET_KEY = os.environ.get(
    "DJANGO_SECRET_KEY", "django-insecure-dev-only-change-me-in-production"
)

DEBUG = os.environ.get("DJANGO_DEBUG", "true").lower() in ("1", "true", "yes")

ALLOWED_HOSTS = [
    h.strip()
    for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if h.strip()
]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "core",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # WhiteNoise serves the collected static files (incl. the built React
    # assets) in production; it must sit right after SecurityMiddleware.
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "finance.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        # The built React SPA lives in frontend/dist; the catch-all route in
        # finance/urls.py serves its index.html for non-API paths.
        "DIRS": [BASE_DIR / "frontend" / "dist"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "finance.wsgi.application"


# Production provides DATABASE_URL (Postgres, e.g. Neon pooled URL with
# ?sslmode=require); locally we keep SQLite. conn_max_age=0: no persistent
# connections, which the Neon pooler requires.
DATABASES = {
    "default": dj_database_url.config(
        default="sqlite:///" + str(BASE_DIR / "db.sqlite3"),
        conn_max_age=0,
    )
}

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]

LANGUAGE_CODE = "en-us"

# Dates and times are stored in UTC; the app's display timezone is IST.
TIME_ZONE = "Asia/Kolkata"
USE_TZ = True

USE_I18N = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# Everything Vite emits into frontend/dist (JS/CSS under assets/, plus
# favicon/icons from frontend/public/) is collected into STATIC_ROOT and
# served by WhiteNoise with hashed names + compression.
STATICFILES_DIRS = [BASE_DIR / "frontend" / "dist"]

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

# Render terminates TLS at its proxy and forwards the scheme in
# X-Forwarded-Proto; without this Django thinks requests are plain HTTP
# and Secure cookies / is_secure() break.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Django REST Framework -------------------------------------------------
# Auth is Django session auth + CSRF, per the blueprint's recommendation for
# a browser app: no long-lived tokens are stored in browser storage.
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
}

# Session/CSRF cookies: the browser (React) reads the csrftoken cookie and
# sends it back as the X-CSRFToken header, so CSRF_COOKIE_HTTPONLY stays
# False while the session cookie itself stays HttpOnly.
CSRF_COOKIE_HTTPONLY = False
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_TRUSTED_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "DJANGO_CSRF_TRUSTED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if o.strip()
]
if not DEBUG:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

# --- App-specific limits ----------------------------------------------------
# CSV uploads: only .csv, at most 5 MB (enforced in the import view).
CSV_UPLOAD_MAX_BYTES = int(os.environ.get("CSV_UPLOAD_MAX_BYTES", 5 * 1024 * 1024))

# Budgets: a category is "near" its limit at 80% spent, "over" above 100%.
BUDGET_NEAR_THRESHOLD = 0.8

# Logging: never log transaction details (amounts, merchants, notes).
# The default Django logging config is kept; views/services must not log
# request bodies or model instances.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {
        "console": {"class": "logging.StreamHandler"},
    },
    "root": {"handlers": ["console"], "level": "INFO"},
}
