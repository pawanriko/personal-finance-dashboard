/** InsForge client — the only place that knows about InsForge auth.
 *
 * HOW IT WORKS: the browser talks to InsForge directly (a different
 * origin — the project's *.insforge.app URL) through the official SDK.
 * The Google/GitHub buttons call `signInWithOAuth`, which redirects
 * to the provider; InsForge redirects back to /login with
 * `?insforge_code=...` and the SDK exchanges it for a session
 * automatically on the next page load. This module then captures the
 * access token (in memory only, never localStorage) and hands it to
 * Django once — `POST /api/auth/insforge/` — which verifies it and
 * starts a normal Django session. The app never sends the InsForge
 * token again; the session cookie is the app's credential from then
 * on (see core/insforge_auth.py).
 *
 * TOKEN TRACKING: the SDK keeps its access token internal — its
 * public auth API has no "give me the token" method. So this module
 * tracks the token itself, capturing `data.accessToken` from every
 * SDK response that returns one (refresh). The one gap is startup:
 * getCurrentUser() proves the session but returns no token, so the
 * init follows it with an explicit refreshSession() to capture a
 * token from the cookie. One extra round-trip per OAuth callback;
 * the alternative (reaching into the SDK's internals) would break
 * on any SDK update.
 *
 * CONFIGURATION: the two Vite env vars (VITE_INSFORGE_URL +
 * VITE_INSFORGE_ANON_KEY) are REQUIRED at build time for the OAuth
 * buttons to appear — with them unset the buttons stay hidden and
 * the app works exactly as before on password login. The anon key
 * is public by design (InsForge's own docs call it browser-safe);
 * it only identifies the project, it grants no user data.
 */
import { createClient } from '@insforge/sdk';

type InsforgeClient = ReturnType<typeof createClient>;

let client: InsforgeClient | null = null;

export function isInsforgeConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_INSFORGE_URL && import.meta.env.VITE_INSFORGE_ANON_KEY,
  );
}

export function getInsforgeClient(): InsforgeClient {
  if (!client) {
    const baseUrl = import.meta.env.VITE_INSFORGE_URL as string | undefined;
    const anonKey = import.meta.env.VITE_INSFORGE_ANON_KEY as
      | string
      | undefined;
    if (!baseUrl || !anonKey) {
      throw new Error(
        'InsForge is not configured — set VITE_INSFORGE_URL and VITE_INSFORGE_ANON_KEY and rebuild.',
      );
    }
    client = createClient({ baseUrl, anonKey });
  }
  return client;
}

// The access token this module tracks (see TOKEN TRACKING above).
// Module-level on purpose: exactly one token per page load, shared
// by the login flow, gone on reload until init restores it.
let accessToken: string | null = null;

function capture(data: { accessToken?: string | null } | null | undefined) {
  if (data?.accessToken) accessToken = data.accessToken;
}

// Startup handshake: finishes the OAuth callback exchange if this
// page load IS one (?insforge_code=...), then restores the session
// from the refresh cookie if there is one. Returns the InsForge user
// or null. The login page awaits this before posting the token to
// Django.
//
// SINGLE-FLIGHT: concurrent callers share one promise. React's
// double-mount (and any future double boot) must not run two refresh
// sequences at once — refresh ROTATES the refresh token, so a racing
// second refresh can lose to the first and report "signed out" for a
// session that is perfectly alive.
let initPromise: Promise<unknown> | null = null;

export function initInsforgeSession(): Promise<unknown> {
  if (!initPromise) initPromise = doInitInsforgeSession();
  return initPromise;
}

async function doInitInsforgeSession(): Promise<unknown> {
  const insforge = getInsforgeClient();
  const { data, error } = await insforge.auth.getCurrentUser();
  if (error || !data?.user) return null;
  // getCurrentUser returns no token, so mint one from the cookie.
  // One retry: a racing refresh (another tab) may have rotated the
  // cookie between the two calls; the retry reads the fresh cookie.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const refreshed = await insforge.auth.refreshSession();
    if (!refreshed.error && refreshed.data?.accessToken) {
      capture(refreshed.data);
      return refreshed.data.user ?? data.user;
    }
  }
  return null;
}

/** The current access token for the Django login call, or null. Does
 * NOT refresh — the caller refreshes (once) on a missing token
 * instead, so an already-valid token costs no extra round-trip. */
export function getAccessToken(): string | null {
  return accessToken;
}

/** Complete the OAuth callback: restore the session (exchanging the
 * `insforge_code` if this load is a callback) and return a fresh
 * access token for Django, or null when there is no InsForge
 * session. */
export async function completeInsforgeSession(): Promise<string | null> {
  await initInsforgeSession();
  if (accessToken) return accessToken;
  const insforge = getInsforgeClient();
  const refreshed = await insforge.auth.refreshSession();
  capture(refreshed.data);
  return accessToken;
}

export async function insforgeSignOut(): Promise<void> {
  accessToken = null;
  initPromise = null;
  // Signing out must never throw: even if the SDK call fails (or
  // the client was never configured), the local session is already
  // dropped above, which is what the UI acts on.
  try {
    await getInsforgeClient().auth.signOut();
  } catch {
    // Already signed out locally; nothing left to do.
  }
}

// Google/GitHub sign-in: the SDK redirects to the provider, the
// provider redirects back to /login with ?insforge_code=..., and the
// SDK exchanges it for a session automatically on the next page load
// (see initInsforgeSession). The redirect URL must be allowlisted in
// the InsForge project (allowed_redirect_urls) or InsForge refuses it.
export async function insforgeSignInWithOAuth(
  provider: 'google' | 'github',
): Promise<void> {
  await getInsforgeClient().auth.signInWithOAuth(provider, {
    redirectTo: `${window.location.origin}/login`,
  });
}
