import 'server-only';

/**
 * The per-attempt OIDC values (state, nonce, PKCE verifier) must survive the
 * round-trip to the IdP and back. We carry them in a short-lived HttpOnly cookie
 * scoped to `/auth` so the callback can recover them — the standard RP pattern.
 * Nothing sensitive to an attacker beyond a single CSRF token, and it is cleared
 * on use.
 */
export const LOGIN_ATTEMPT_COOKIE = 'app_auth_attempt';

/** 10 minutes: long enough to log in, short enough to expire stale attempts. */
export const LOGIN_ATTEMPT_TTL_S = 10 * 60;

export const LOGIN_ATTEMPT_PATH = '/auth';

export interface LoginAttempt {
  state: string;
  nonce: string;
  codeVerifier: string;
  /** Validated same-origin path to land on after auth; absent → default landing. */
  returnTo?: string;
}

const MAX_RETURN_TO_LENGTH = 2048;

/**
 * Pure `returnTo` gate: only a LOCAL absolute path survives — leading `/`, not
 * protocol-relative (`//host`), no backslash, no control character, bounded
 * length. Percent-encoding is deliberately NOT decoded, so an encoded `//` can
 * never become a different origin here; consumers redirect with it as-is or drop
 * it. `undefined` in, `undefined` out.
 */
export function sanitizeReturnTo(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  if (value.length > MAX_RETURN_TO_LENGTH) return undefined;
  if (!value.startsWith('/')) return undefined;
  if (value.startsWith('//')) return undefined;
  if (value.includes('\\')) return undefined;
  if (/[\u0000-\u001f\u007f]/.test(value)) return undefined;
  return value;
}

export function encodeLoginAttempt(attempt: LoginAttempt): string {
  const returnTo = sanitizeReturnTo(attempt.returnTo);
  const payload: LoginAttempt = returnTo
    ? { state: attempt.state, nonce: attempt.nonce, codeVerifier: attempt.codeVerifier, returnTo }
    : { state: attempt.state, nonce: attempt.nonce, codeVerifier: attempt.codeVerifier };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeLoginAttempt(value: string | undefined): LoginAttempt | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString()) as LoginAttempt;
    if (
      typeof parsed.state === 'string' &&
      typeof parsed.nonce === 'string' &&
      typeof parsed.codeVerifier === 'string'
    ) {
      const returnTo = sanitizeReturnTo(parsed.returnTo);
      if (returnTo) return { ...parsed, returnTo };
      delete parsed.returnTo;
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function loginAttemptCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: LOGIN_ATTEMPT_PATH,
    secure,
    maxAge: LOGIN_ATTEMPT_TTL_S,
  };
}
