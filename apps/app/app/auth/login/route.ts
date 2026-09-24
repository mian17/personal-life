import { NextResponse, type NextRequest } from 'next/server';
import { buildAuthorizationRequest } from '@/lib/auth/oidc-client';
import {
  LOGIN_ATTEMPT_COOKIE,
  encodeLoginAttempt,
  loginAttemptCookieOptions,
} from '@/lib/auth/login-attempt';

export const dynamic = 'force-dynamic';

/**
 * `GET /auth/login` — starts the authorization code + PKCE dance: builds the
 * IdP authorization URL (with `state`, `nonce`, S256 challenge, and the
 * `resource` indicator), stashes the per-attempt values in a short-lived
 * HttpOnly cookie, and redirects the browser to the IdP.
 */
export async function GET(_req: NextRequest): Promise<NextResponse> {
  const attempt = await buildAuthorizationRequest();

  const res = NextResponse.redirect(attempt.url, { status: 303 });
  res.cookies.set(
    LOGIN_ATTEMPT_COOKIE,
    encodeLoginAttempt({
      state: attempt.state,
      nonce: attempt.nonce,
      codeVerifier: attempt.codeVerifier,
    }),
    loginAttemptCookieOptions(),
  );
  return res;
}
