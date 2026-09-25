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
import { getRefreshLock, type RefreshLock } from './refresh-lock';

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

/**
 * Test aid: drop the in-flight map. A cross-replica lock test needs to simulate
 * a *second process* — clearing the map makes the next caller skip the
 * single-flight fast path and actually contend for the Redis lock.
 */
export function clearInFlightRefreshes(): void {
  inFlightRefreshes().clear();
}

/**
 * Performs one token refresh and applies it to the store (or destroys on failure).
 *
 * The store's `now` clock is used for the *expiry math* of the rotated tokens
 * (deterministic in tests), while the cross-replica lock wait is bounded by real
 * wall-clock time — a test's injected clock advances instantly and must not be
 * able to make a loser wait forever.
 */
async function performRefresh(
  session: AppSession,
  at: number,
  refresh: typeof refreshTokens,
  store: SessionStoreApi,
  lock: RefreshLock,
): Promise<RefreshResult> {
  // No shared Redis: there is no cross-replica race to guard, so keep today's
  // exact path — no lock round-trip, no re-read, no extra await — and let the
  // in-process single-flight above carry the whole guarantee.
  if (!lock.distributed) return refreshDirectly(session, at, refresh, store);

  const acquired = await lock.acquire(session.id);
  if (acquired.status === 'busy') {
    return await waitForWinner(session, store, lock);
  }

  // EVERY path after a successful acquire must release the lock. The two early
  // returns below used to sit before the try/finally, leaking
  // `app:lock:refresh:<id>` for its whole TTL: other replicas would then see
  // `busy` and either wait out the TTL or spuriously re-login. Wrapping the
  // whole post-acquire body keeps the vanished / tokens-adopted / refresh-failure
  // paths covered too.
  try {
    // Re-read under the lock before spending the refresh token. The `session` we
    // hold was read *before* the lock, so a winner may have rotated it in the gap
    // (or in the gap between our own in-process single-flight and acquiring).
    // Presenting that stale refresh token would be a second use of a rotated
    // token — the reuse-detection defect. If the record is already newer, adopt
    // it and never touch the token.
    const current = await store.get(session.id);
    if (!current) return undefined;
    if (
      current.accessToken !== session.accessToken ||
      current.refreshToken !== session.refreshToken
    ) {
      return current;
    }

    return await refreshDirectly(current, at, refresh, store);
  } finally {
    // Best-effort release; the TTL reaps a crashed holder, and a failed release
    // (degraded Redis) must not mask the refresh result.
    if (acquired.status === 'acquired') void acquired.release();
  }
}

/** The actual refresh: present the token, store the rotation, or destroy. */
async function refreshDirectly(
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
 * The lock-loser path: we did NOT take the lock, so we must never present a
 * refresh token. Instead we poll the session record for the winner's rotated
 * tokens — success is detected by the tokens differing from the snapshot we
 * read before the lock (the winner's `update` mutates access AND refresh token
 * together; rotation guarantees both change). We give up when:
 * - the session vanished (the winner's refresh failed and destroyed it), or
 * - the wait exceeds the lock TTL.
 * Both mean "re-login" (`undefined`). A crashed winner's lock simply expires and
 * a later request retries; a *live* winner that wrote nothing is also bounded by
 * the same TTL (we never wait on the session's 7-day window).
 */
async function waitForWinner(
  session: AppSession,
  store: SessionStoreApi,
  lock: RefreshLock,
): Promise<RefreshResult> {
  const deadline = Date.now() + lock.ttlMs;
  for (;;) {
    await sleep(lock.pollIntervalMs);
    const current = await store.get(session.id);
    if (!current) return undefined;
    if (
      current.accessToken !== session.accessToken ||
      current.refreshToken !== session.refreshToken
    ) {
      // The winner rotated the tokens: hand the winner's session back. This is
      // the whole point of the lock — the loser presents no token itself.
      return current;
    }
    if (Date.now() >= deadline) return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  const refreshPromise = performRefresh(session, at, refresh, store, getRefreshLock()).finally(
    () => {
      // Clear on settle — success AND failure. A stale entry would make a later
      // request reuse a settled (possibly destroyed-session) result.
      inFlight.delete(session.id);
    },
  );
  inFlight.set(session.id, refreshPromise);
  return refreshPromise;
}
