import 'server-only';
import { randomBytes } from 'crypto';
import {
  REFRESH_SKEW_MS,
  SESSION_TTL_MS,
  sessionStore,
  SessionStore,
  type AppSession,
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
export function createSession(
  tokens: Tokens,
  store: SessionStore = sessionStore,
): AppSession {
  return store.create({
    id: newSessionId(),
    subject: tokens.subject ?? 'unknown',
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    idToken: tokens.idToken,
    accessTokenExpiresAt: expiryFrom(tokens, store.nowMs()),
  });
}

export function readSession(id: string | undefined, store: SessionStore = sessionStore): AppSession | undefined {
  return store.get(id);
}

export function destroySession(id: string | undefined, store: SessionStore = sessionStore): void {
  store.destroy(id);
}

/**
 * Returns a session with a usable access token, refreshing it when it is within
 * `REFRESH_SKEW_MS` of expiry.
 *
 * On ANY refresh failure we destroy the session and return undefined — the
 * caller must treat that as "re-login". We never retry: family revocation
 * (decision B) means a replayed/failed refresh can invalidate the chain, and
 * the only correct response is a fresh authorization dance.
 */
export async function getValidSession(
  id: string | undefined,
  now: number | undefined = undefined,
  refresh: typeof refreshTokens = refreshTokens,
  store: SessionStore = sessionStore,
): Promise<AppSession | undefined> {
  const at = now ?? store.nowMs();
  const session = store.get(id);
  if (!session) return undefined;

  if (session.accessTokenExpiresAt - at > REFRESH_SKEW_MS) {
    return session;
  }

  if (!session.refreshToken) {
    store.destroy(session.id);
    return undefined;
  }

  try {
    const tokens = await refresh(session.refreshToken);
    return store.update(session.id, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      idToken: tokens.idToken,
      accessTokenExpiresAt: expiryFrom(tokens, at),
    });
  } catch {
    // Refresh failed (invalid_grant, family revoked, IdP down): re-login.
    store.destroy(session.id);
    return undefined;
  }
}
