import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, clearedCookieOptions } from '@/lib/auth/cookies';
import { destroySession } from '@/lib/auth/session';
import { getIdpIssuer } from '@/lib/auth/oidc-client';
import { buildIdpLogoutUrl } from '@/lib/auth/logout';

export const dynamic = 'force-dynamic';

/**
 * `POST /auth/logout` — kills the app session first, then sends the browser on a
 * plain top-level GET to the IdP's `/logout` landing. That landing auto-POSTs to
 * the IdP's own `POST /logout` from the IdP origin, so the IdP session cookie is
 * always attached and decision-B grant revocation fires — regardless of where
 * the logout started (this is what makes the chain cross-site-safe).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  await destroySession(req.cookies.get(SESSION_COOKIE)?.value);

  // The dev-stack flag decides `Secure` on the cleared cookie (see the login route).
  const secure = process.env.APP_DEV_SKIP_ACCESS_GATE !== '1';
  const res = NextResponse.redirect(buildIdpLogoutUrl(getIdpIssuer()), { status: 303 });
  res.cookies.set(SESSION_COOKIE, '', clearedCookieOptions(secure));
  return res;
}
