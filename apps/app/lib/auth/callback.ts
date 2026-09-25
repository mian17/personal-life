import 'server-only';
import type { completeAuthorization as CompleteAuthorization } from './oidc-client';
import type { createSession as CreateSession } from './session';
import { decodeLoginAttempt } from './login-attempt';

/**
 * Pure-ish callback decision logic, with the two network/side-effecting seams
 * (`completeAuthorization`, `createSession`) injected so the route can be tested
 * without a live IdP. Fails closed on every error path.
 *
 * ⚠️ With `REDIS_URL` set, `createSession` reaches `RedisSessionStore.create`,
 * which throws `SessionStoreUnavailable` when the store is unreachable (it never
 * persists a half-issued session). That call is wrapped below and mapped to a
 * clean, retryable failure — an unhandled rejection here would 500 the callback.
 */

export type CallbackResult =
  | { ok: true; sessionId: string }
  | { ok: false; status: number; message: string };

export interface CallbackDeps {
  completeAuthorization: typeof CompleteAuthorization;
  createSession: typeof CreateSession;
}

/**
 * Rebuild the callback URL from the *configured* redirect URI, carrying over the
 * authorization response query. Behind Next (and any proxy) `req.url` reports an
 * internal host (`http://localhost:…`), but the token request's `redirect_uri`
 * must byte-match what the IdP registered. The registered value is authoritative.
 */
export function buildExchangeUrl(redirectUri: string, callbackUrl: string): URL {
  const exchange = new URL(redirectUri);
  const incoming = new URL(callbackUrl);
  incoming.searchParams.forEach((value, key) => exchange.searchParams.append(key, value));
  return exchange;
}

export async function resolveCallback(
  callbackUrl: string,
  redirectUri: string,
  attemptCookie: string | undefined,
  deps: CallbackDeps,
): Promise<CallbackResult> {
  const attempt = decodeLoginAttempt(attemptCookie);
  if (!attempt) {
    // The attempt cookie is scoped to `/auth` and bound to the browser origin.
    // Loopback spellings (`127.0.0.1`, `[::1]`, `localhost`) are distinct hosts
    // for cookies, and Next's middleware normalization can move the browser
    // between the two, so this fails closed rather than guessing.
    return { ok: false, status: 400, message: 'missing or invalid auth attempt' };
  }

  let url: URL;
  try {
    url = buildExchangeUrl(redirectUri, callbackUrl);
  } catch {
    return { ok: false, status: 400, message: 'invalid callback URL' };
  }

  // The IdP may report an authorization error (e.g. access_denied) on the redirect.
  if (url.searchParams.has('error')) {
    return { ok: false, status: 400, message: 'authorization request was denied' };
  }
  if (!url.searchParams.has('code')) {
    return { ok: false, status: 400, message: 'missing authorization code' };
  }

  let tokens;
  try {
    tokens = await deps.completeAuthorization(url, {
      state: attempt.state,
      nonce: attempt.nonce,
      codeVerifier: attempt.codeVerifier,
    });
  } catch {
    // state/nonce/verifier mismatch, bad code, token endpoint failure — all fail closed.
    return { ok: false, status: 400, message: 'authorization failed' };
  }

  try {
    const session = await deps.createSession(tokens);
    return { ok: true, sessionId: session.id };
  } catch {
    // Store unavailable (Redis down/connecting) — the IdP dance succeeded but we
    // cannot persist the session. Fail closed with the same clean failure shape
    // as a denied login (no stack trace, no half-issued cookie) so the user can
    // simply retry; never fall back to per-instance memory.
    return { ok: false, status: 400, message: 'authorization failed' };
  }
}
