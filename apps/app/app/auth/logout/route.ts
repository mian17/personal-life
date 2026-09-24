import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, clearedCookieOptions } from '@/lib/auth/cookies';
import { destroySession } from '@/lib/auth/session';
import { getIdpIssuer } from '@/lib/auth/oidc-client';
import { buildIdpLogoutUrl } from '@/lib/auth/logout';

export const dynamic = 'force-dynamic';

/**
 * `POST /auth/logout` — kills the app session first, then hands off to the
 * IdP's `POST /logout` so decision-B grant revocation fires server-side there
 * (every refresh token dies).
 *
 * The hand-off uses HTTP 307 (method-preserving): the browser re-POSTs to the
 * IdP logout with its own IdP session cookie, which is the only way the IdP can
 * identify the account to revoke — the app could not POST on the browser's
 * behalf without that cookie. A 303 would downgrade to GET and miss the route.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  destroySession(req.cookies.get(SESSION_COOKIE)?.value);

  const res = NextResponse.redirect(buildIdpLogoutUrl(getIdpIssuer()), { status: 307 });
  res.cookies.set(SESSION_COOKIE, '', clearedCookieOptions());
  return res;
}
