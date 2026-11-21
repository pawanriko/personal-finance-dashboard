"""InsForge JWT verification for the login-time identity bridge.

WHAT THIS IS: the credential check for "Continue with Google/GitHub".
The React app signs the user in against InsForge (Google or GitHub
OAuth via the @insforge/sdk) and hands the resulting access token to
``POST /api/auth/insforge/`` (see views.insforge_login_view). This
module verifies that token and turns it into the Django user the rest
of the app already knows — then the view starts a normal Django
session, so every view, every ``request.user`` check, and every
``owner`` foreign key works unchanged, and no Bearer token is ever
sent again.

WHERE IT LIVES: this module + ``core/models.py`` (the
``InsforgeIdentity`` link table) + the one endpoint in views.py. No
middleware: unlike HireSense (which verifies a Bearer token on every
/API/ request), this app verifies the token exactly once, at login.

WHY JWKS, NOT A SHARED SECRET: InsForge signs access tokens with
RS256 (an asymmetric key pair) and publishes the public keys at
``/.well-known/jwks.json`` on the project URL. Django verifies the
signature with the PUBLIC key, so no secret ever has to live in this
codebase or in Render's env vars — and when InsForge rotates keys,
the ``kid`` header tells Django which public key to use. (Proven by
the HireSense Phase 0 spike against the real project; the old docs'
HS256 table is stale.)

HOW IT WORKS, STEP BY STEP:
  1. ``verify_token`` checks the JWT header (must be RS256), fetches
     the JWKS document (cached, refetched once on an unknown ``kid``),
     and lets PyJWT verify the signature + expiry. InsForge tokens
     carry no ``iss``/``aud`` claims, so those are not checked.
  2. ``resolve_user`` maps the verified ``sub`` claim to a Django
     user via InsforgeIdentity. Unknown ``sub`` + unused email ->
     a new Django user is created with an unusable password (it can
     never sign in with a password — InsForge owns the credential).
     Unknown ``sub`` + email that already belongs to an unlinked
     Django account -> 409: the link must never happen silently,
     because with email verification off an email match alone proves
     nothing. (There is no link command in this app; the user signs
     in with their password instead.)
  3. The token is never logged and never stored. Logout is Django's
     session logout plus the frontend dropping the SDK token.

WHAT IT DOES NOT DO: it never mints tokens, never talks to InsForge
about passwords, and never revokes anything. A logged-out InsForge
access token stays valid until its 15-minute expiry — harmless here,
because this backend never accepts Bearer tokens.
"""

import json
import logging
import re
import time

import jwt
import requests
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction

from .models import InsforgeIdentity

logger = logging.getLogger(__name__)


class InsforgeAuthError(Exception):
    """The token is missing, malformed, expired, or badly signed."""


class InsforgeEmailCollision(InsforgeAuthError):
    """The token's email belongs to an unlinked Django account.

    Separate from InsforgeAuthError so the view can answer 409
    ("sign in with your password instead") instead of the
    anonymous 401.
    """


# One process-wide JWKS cache: {keys: [...], fetched_at: monotonic}.
# gunicorn runs one worker by default on this project, and even with
# more workers each would just fetch its own copy — the document is
# public and tiny, so per-process caching is fine.
_jwks_cache = {"keys": None, "fetched_at": 0.0}


def _jwks_url():
    return settings.INSFORGE_BASE_URL.rstrip("/") + "/.well-known/jwks.json"


def _fetch_jwks(force=False):
    """Return the project's JWKS key list, cached for
    INSFORGE_JWKS_CACHE_TTL seconds. ``force=True`` refetches even
    when the cache is fresh (used on an unknown ``kid`` — rotation).
    Raises InsforgeAuthError on any fetch/parse failure.
    """
    now = time.monotonic()
    if (
        not force
        and _jwks_cache["keys"] is not None
        and now - _jwks_cache["fetched_at"] < settings.INSFORGE_JWKS_CACHE_TTL
    ):
        return _jwks_cache["keys"]
    try:
        response = requests.get(_jwks_url(), timeout=10)
        response.raise_for_status()
        keys = response.json().get("keys", [])
    except (requests.RequestException, ValueError) as exc:
        logger.warning("InsForge JWKS fetch failed: %s", exc)
        raise InsforgeAuthError("Could not fetch InsForge signing keys") from exc
    _jwks_cache.update({"keys": keys, "fetched_at": now})
    return keys


def _signing_key(kid):
    """The RSA public key for ``kid``, or None. Refetches once on a
    miss so a rotated key works without waiting out the cache TTL.
    """
    for attempt in range(2):
        for jwk in _fetch_jwks(force=attempt == 1):
            if jwk.get("kid") == kid:
                return jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(jwk))
    return None


def verify_token(token):
    """Verify an InsForge access token. Returns the claims dict
    (``sub``, ``email``, ``role``, ``iat``, ``exp``) or raises
    InsforgeAuthError.
    """
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise InsforgeAuthError("Malformed token") from exc
    if header.get("alg") != "RS256":
        raise InsforgeAuthError("Unexpected signing algorithm")
    key = _signing_key(header.get("kid"))
    if key is None:
        raise InsforgeAuthError("Unknown signing key")
    try:
        # No `aud` claim exists on InsForge tokens (spike-proven), so
        # audience verification is off; `exp` + `sub` are required.
        # `leeway` tolerates the ~1-2s clock skew between InsForge's
        # servers and this one (see INSFORGE_JWT_LEEWAY in settings).
        return jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            options={"verify_aud": False, "require": ["exp", "sub"]},
            leeway=settings.INSFORGE_JWT_LEEWAY,
        )
    except jwt.PyJWTError as exc:
        raise InsforgeAuthError("Token verification failed") from exc


def _unique_username(email):
    """A Django username derived from the email's local part, made
    unique with a numeric suffix if the base is taken. Usernames are
    display-only after OAuth (sign-in uses the provider), so the exact
    form does not matter — only uniqueness does.
    """
    base = re.sub(r"[^a-zA-Z0-9_.-]", "_", (email.split("@")[0] or "user"))
    base = base[:30] or "user"
    user_model = get_user_model()
    candidate, n = base, 0
    while user_model.objects.filter(username__iexact=candidate).exists():
        n += 1
        candidate = f"{base}_{n}"
    return candidate


def resolve_user(claims):
    """Map verified claims to a Django user (see module docstring).

    Raises InsforgeEmailCollision when the token's email already
    belongs to an unlinked Django account.
    """
    sub = claims["sub"]
    email = (claims.get("email") or "").strip()
    user_model = get_user_model()
    # RACE-SAFE creation, up to 3 attempts: two requests carrying
    # the same fresh token (a double-mounted app, or a double-clicked
    # OAuth button) can both pass the lookup below. Creation runs in
    # one transaction; a unique-constraint loss means a concurrent
    # request won the race (or took the username) — loop back,
    # re-look-up, and either return the winner's row or retry with a
    # fresh username.
    for _attempt in range(3):
        try:
            identity = InsforgeIdentity.objects.select_related("user").get(
                sub=sub
            )
        except InsforgeIdentity.DoesNotExist:
            identity = None
        if identity is not None:
            user = identity.user
            if email and user.email != email:
                user.email = email
                user.save(update_fields=["email"])
            return user
        if email and user_model.objects.filter(email__iexact=email).exists():
            raise InsforgeEmailCollision(
                "An account with this email already exists. Sign in "
                "with your username and password instead."
            )
        try:
            with transaction.atomic():
                user = user_model.objects.create_user(
                    username=_unique_username(email), email=email
                )
                # create_user with no password already sets an
                # unusable one; state it explicitly so the intent
                # survives a future reader's skim.
                user.set_unusable_password()
                user.save(update_fields=["password"])
                InsforgeIdentity.objects.create(
                    user=user, sub=sub, email=email
                )
        except IntegrityError:
            continue
        return user
    raise InsforgeAuthError("Could not provision a user for this token")
