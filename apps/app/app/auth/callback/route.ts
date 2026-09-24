import { NextResponse, type NextRequest } from 'next/server';
import { completeAuthorization } from '@/lib/auth/oidc-client';
import { getAuthEnv } from '@/lib/auth/env';
import { LOGIN_ATTEMPT_COOKIE, loginAttemptCookieOptions } from '@/lib/auth/login-attempt';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/cookies';
import { createSession } from '@/lib/auth/session';
import { resolveCallback } from '@/lib/auth/callback';
import { absoluteUrl } from '@/lib/auth/origin';

export const dynamic = 'force-dynamic';

/**
 * `GET /auth/callback` — completes the code+PKCE dance.
 *
 * Fails closed: any failure (missing/expired attempt, `state`/`nonce`/verifier
 * mismatch, IdP error, token-exchange failure) returns a 4xx and creates no
 * session. The attempt cookie is always cleared.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { redirectUri } = getAuthEnv();
  const outcome = await resolveCallback(
    req.url,
    redirectUri,
    req.cookies.get(LOGIN_ATTEMPT_COOKIE)?.value,
    { completeAuthorization, createSession },
  );

  const res = outcome.ok
    ? NextResponse.redirect(absoluteUrl(req, '/'), { status: 303 })
    : new NextResponse(outcome.message, { status: outcome.status });

  // The attempt is single-use regardless of outcome.
  res.cookies.set(LOGIN_ATTEMPT_COOKIE, '', { ...loginAttemptCookieOptions(), maxAge: 0 });

  if (outcome.ok) {
    res.cookies.set(SESSION_COOKIE, outcome.sessionId, sessionCookieOptions());
  }
  return res;
}
