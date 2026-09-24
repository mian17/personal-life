import 'server-only';
import type { completeAuthorization as CompleteAuthorization } from './oidc-client';
import type { createSession as CreateSession } from './session';
import { decodeLoginAttempt } from './login-attempt';

/**
 * Pure-ish callback decision logic, with the two network/side-effecting seams
 * (`completeAuthorization`, `createSession`) injected so the route can be tested
 * without a live IdP. Fails closed on every error path.
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

  const session = deps.createSession(tokens);
  return { ok: true, sessionId: session.id };
}
