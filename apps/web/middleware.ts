import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  // ponytail: opt-in local bypass for dev; remove when local browsing isn't needed.
  if (process.env.DEV_AUTH_BYPASS === 'true') return NextResponse.next();

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
