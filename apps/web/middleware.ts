import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  // Dev skips auth so localhost works without headers; production logic below is unchanged.
  if (process.env.NODE_ENV === 'development') return NextResponse.next();

  // Serve-proxied traffic carries x-forwarded-host; direct local traffic does not.
  // The web app binds to loopback, so header-less requests can only be the local host.
  const viaServe = req.headers.has('x-forwarded-host');
  if (!viaServe) return NextResponse.next();

  const owner = process.env.OWNER_LOGIN;
  const login = req.headers.get('tailscale-user-login');
  if (!owner || !login || login.toLowerCase() !== owner.toLowerCase()) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json).*)'],
};
