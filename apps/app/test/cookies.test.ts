import { SESSION_COOKIE, clearedCookieOptions, sessionCookieOptions } from '@/lib/auth/cookies';

const env = process.env as Record<string, string | undefined>;

describe('session cookie flags', () => {
  it('is HttpOnly, SameSite=Lax, Path=/', () => {
    const opts = sessionCookieOptions(false);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('lax');
    expect(opts.path).toBe('/');
  });

  it('sets Secure from the boolean it is given', () => {
    // The caller derives it from the dev-stack flag; the helper reads no env.
    expect(sessionCookieOptions(true).secure).toBe(true);
    expect(sessionCookieOptions(false).secure).toBe(false);
  });

  it('does not consult NODE_ENV for Secure', () => {
    const previous = env.NODE_ENV;
    try {
      env.NODE_ENV = 'production';
      expect(sessionCookieOptions(false).secure).toBe(false);
    } finally {
      env.NODE_ENV = previous;
    }
  });

  it('uses a 7-day max age by default', () => {
    expect(sessionCookieOptions(false).maxAge).toBe(7 * 24 * 60 * 60);
  });

  it('clears the cookie with maxAge 0, keeping the caller’s Secure flag', () => {
    const cleared = clearedCookieOptions(true);
    expect(cleared.maxAge).toBe(0);
    expect(cleared.httpOnly).toBe(true);
    expect(cleared.sameSite).toBe('lax');
    expect(cleared.secure).toBe(true);
  });

  it('names the cookie opaquely (no token in the name)', () => {
    expect(SESSION_COOKIE).toBe('app_session');
  });
});
