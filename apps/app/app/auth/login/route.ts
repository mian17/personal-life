import { NextResponse, type NextRequest } from 'next/server';
import { buildAuthorizationRequest } from '@/lib/auth/oidc-client';
import {
  LOGIN_ATTEMPT_COOKIE,
  encodeLoginAttempt,
  loginAttemptCookieOptions,
} from '@/lib/auth/login-attempt';

export const dynamic = 'force-dynamic';

/**
 * Honest failure page when the IdP cannot be reached to start the dance.
 * Deliberately minimal and static (no auth imports, so it can be returned from
 * the catch below without any further failure mode). Server-rendered.
 */
function identityUnavailable(): NextResponse {
  const body = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Identity service unavailable</title></head>
<body><main><h1>Identity service unavailable</h1>
<p>The identity service is not reachable, so you cannot sign in right now. Try again shortly.</p>
</main></body></html>`;
  return new NextResponse(body, {
    status: 503,
    headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '30' },
  });
}

/**
 * `GET /auth/login` — starts the authorization code + PKCE dance: builds the
 * IdP authorization URL (with `state`, `nonce`, S256 challenge, and the
 * `resource` indicator), stashes the per-attempt values in a short-lived
 * HttpOnly cookie, and redirects the browser to the IdP.
 *
 * If the IdP is unreachable (discovery/token-endpoint fetch fails), returns a
 * small honest `503` page instead of surfacing a raw 500 with a stack trace.
 */
export async function GET(_req: NextRequest): Promise<NextResponse> {
  let attempt;
  try {
    attempt = await buildAuthorizationRequest();
  } catch {
    return identityUnavailable();
  }

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
