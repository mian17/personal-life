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
}

export function encodeLoginAttempt(attempt: LoginAttempt): string {
  return Buffer.from(JSON.stringify(attempt)).toString('base64url');
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
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function loginAttemptCookieOptions(
  isProduction: boolean = process.env.NODE_ENV === 'production',
) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: LOGIN_ATTEMPT_PATH,
    secure: isProduction,
    maxAge: LOGIN_ATTEMPT_TTL_S,
  };
}
