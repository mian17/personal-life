import 'server-only';
import { randomBytes } from 'crypto';
import {
  REFRESH_SKEW_MS,
  SESSION_TTL_MS,
  sessionStore,
  type AppSession,
  type SessionStoreApi,
} from './session-store';
import { refreshTokens, type Tokens } from './oidc-client';

/**
 * Session lifecycle: create from a token response, read (with near-expiry
 * refresh), and destroy. Tokens never leave this layer except into the store.
 */

export { SESSION_TTL_MS } from './session-store';

function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

function expiryFrom(tokens: Tokens, now: number): number {
  return now + (tokens.expiresIn ?? 600) * 1000;
}

/** Creates a session for a freshly-completed login and returns it. */
export async function createSession(
  tokens: Tokens,
  store: SessionStoreApi = sessionStore,
): Promise<AppSession> {
  return store.create({
    id: newSessionId(),
    subject: tokens.subject ?? 'unknown',
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    idToken: tokens.idToken,
    accessTokenExpiresAt: expiryFrom(tokens, await store.nowMs()),
  });
}

export async function readSession(
  id: string | undefined,
  store: SessionStoreApi = sessionStore,
): Promise<AppSession | undefined> {
  return store.get(id);
}

export async function destroySession(
  id: string | undefined,
  store: SessionStoreApi = sessionStore,
): Promise<void> {
  await store.destroy(id);
}

/**
 * In-flight refresh promises, keyed by session id. Anchored on `globalThis` for
 * the same reason the session store is (see `session-store.ts`): Next runs
 * middleware and route handlers in separate module registries, and dev HMR
 * reloads modules — all share one process, so the map must be process-wide.
 *
 * Why single-flight: a page can fan out two callers that both call
 * `requireSession()` for the same cookie (`app/page.tsx` does
 * `Promise.all([listNotes, listTags])`). When the access token is inside
 * `REFRESH_SKEW_MS`, both would present the *same* rotating refresh token to the
 * IdP. Refresh rotation has reuse detection, so the second use revokes the whole
 * grant family and forces a re-login about every access-token lifetime. Sharing
 * one promise makes concurrent callers perform exactly one refresh.
 */
const GLOBAL_REFRESH_KEY = '__lifeAppSessionRefreshInFlight';

type RefreshResult = AppSession | undefined;

function inFlightRefreshes(): Map<string, Promise<RefreshResult>> {
  const holder = globalThis as unknown as Record<
    string,
    Map<string, Promise<RefreshResult>> | undefined
  >;
  holder[GLOBAL_REFRESH_KEY] ??= new Map();
  return holder[GLOBAL_REFRESH_KEY]!;
}

/** Performs one token refresh and applies it to the store (or destroys on failure). */
async function performRefresh(
  session: AppSession,
  at: number,
  refresh: typeof refreshTokens,
  store: SessionStoreApi,
): Promise<RefreshResult> {
  try {
    const tokens = await refresh(session.refreshToken);
    return await store.update(session.id, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      idToken: tokens.idToken,
      accessTokenExpiresAt: expiryFrom(tokens, at),
    });
  } catch {
    // Refresh failed (invalid_grant, family revoked, IdP down): re-login.
    // `await` before the delete: a Redis update can reject after its write (or
    // race) and the delete must not be lost behind a detached promise.
    await store.destroy(session.id);
    return undefined;
  }
}

/**
 * Returns a session with a usable access token, refreshing it when it is within
 * `REFRESH_SKEW_MS` of expiry.
 *
 * On ANY refresh failure we destroy the session and return undefined — the
 * caller must treat that as "re-login". We never retry: family revocation
 * (decision B) means a replayed/failed refresh can invalidate the chain, and
 * the only correct response is a fresh authorization dance.
 *
 * Concurrent callers for the same session share one in-flight refresh (see
 * above); the map entry is cleared when that promise settles, success or
 * failure, so a later request can refresh again.
 */
export async function getValidSession(
  id: string | undefined,
  now: number | undefined = undefined,
  refresh: typeof refreshTokens = refreshTokens,
  store: SessionStoreApi = sessionStore,
): Promise<AppSession | undefined> {
  const at = now ?? (await store.nowMs());
  const session = await store.get(id);
  if (!session) return undefined;

  if (session.accessTokenExpiresAt - at > REFRESH_SKEW_MS) {
    return session;
  }

  if (!session.refreshToken) {
    await store.destroy(session.id);
    return undefined;
  }

  const inFlight = inFlightRefreshes();
  const existing = inFlight.get(session.id);
  if (existing) return existing;

  const refreshPromise = performRefresh(session, at, refresh, store).finally(() => {
    // Clear on settle — success AND failure. A stale entry would make a later
    // request reuse a settled (possibly destroyed-session) result.
    inFlight.delete(session.id);
  });
  inFlight.set(session.id, refreshPromise);
  return refreshPromise;
}
