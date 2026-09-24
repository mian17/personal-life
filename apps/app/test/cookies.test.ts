import { SESSION_COOKIE, clearedCookieOptions, sessionCookieOptions } from '@/lib/auth/cookies';

describe('session cookie flags', () => {
  it('is HttpOnly, SameSite=Lax, Path=/', () => {
    const opts = sessionCookieOptions(false);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('lax');
    expect(opts.path).toBe('/');
  });

  it('sets Secure in production only', () => {
    expect(sessionCookieOptions(true).secure).toBe(true);
    expect(sessionCookieOptions(false).secure).toBe(false);
  });

  it('uses a 7-day max age by default', () => {
    expect(sessionCookieOptions(false).maxAge).toBe(7 * 24 * 60 * 60);
  });

  it('clears the cookie with maxAge 0', () => {
    const cleared = clearedCookieOptions(false);
    expect(cleared.maxAge).toBe(0);
    expect(cleared.httpOnly).toBe(true);
    expect(cleared.sameSite).toBe('lax');
  });

  it('names the cookie opaquely (no token in the name)', () => {
    expect(SESSION_COOKIE).toBe('app_session');
  });
});
