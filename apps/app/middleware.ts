import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/cookies';
import { sessionStore } from '@/lib/auth/session-store';
import { decideGate } from '@/lib/auth/gate';
import { absoluteUrl } from '@/lib/auth/origin';

/**
 * Two independent gates run here:
 *
 *  1. ACCESS (Tailscale) — unchanged semantics: only the owner's device may
 *     reach the app. It never establishes identity.
 *  2. IDENTITY (IdP) — a valid app session (from the Task 7 code+PKCE flow) is
 *     required; otherwise the user is sent to start the login dance. Identity
 *     comes only from the IdP-backed session.
 *
 * Runs on the Node.js runtime. With `REDIS_URL` unset it reads the same
 * in-process session store the callback route writes to (they share
 * `globalThis`, not module scope); with it set both go through one shared Redis.
 *
 * ⚠️ `sessionStore.get` is a `MaybePromise` — with a Redis store it returns a
 * Promise. The `await` below is load-bearing for security: `Boolean(promise)` is
 * always `true`, so a bare `Boolean(sessionStore.get(...))` would pass every
 * unauthenticated request. `middleware.test.ts` pins “no session → login”.
 *
 * The login redirect carries the requested path as `returnTo` when it is safe to
 * resume (a GET navigation outside `/api/*`); the value is validated downstream
 * by `sanitizeReturnTo`, so it can never move the browser off-origin.
 */
export async function middleware(req: NextRequest) {
  const hasValidSession = Boolean(await sessionStore.get(req.cookies.get(SESSION_COOKIE)?.value));

  const decision = decideGate({
    isProduction: process.env.NODE_ENV === 'production',
    pathname: req.nextUrl.pathname,
    hasForwardedHost: req.headers.has('x-forwarded-host'),
    tailscaleLogin: req.headers.get('tailscale-user-login'),
    ownerLogin: process.env.OWNER_LOGIN,
    hasValidSession,
  });

  if (decision === 'forbidden') {
    return new NextResponse('Forbidden', { status: 403 });
  }
  if (decision === 'redirect-login') {
    // Built on the request's external origin; Next normalizes loopback hosts
    // (127.0.0.1 → localhost) in redirects, so the test client uses localhost too.
    const login = absoluteUrl(req, '/auth/login');
    // Resume where the user was headed, but only for a safe navigation: a GET to
    // a page (not a POST-only BFF route), and never for API calls.
    if (req.method === 'GET' && !req.nextUrl.pathname.startsWith('/api/')) {
      login.searchParams.set('returnTo', `${req.nextUrl.pathname}${req.nextUrl.search}`);
    }
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json).*)'],
};
