/**
 * The per-attempt cookie may carry a `returnTo` path back to the requested page
 * after auth. It is attacker-influenced (query string), so it must only ever be a
 * same-origin absolute path — the sanitizer is the single gate.
 */

import {
  LOGIN_ATTEMPT_COOKIE,
  LOGIN_ATTEMPT_PATH,
  LOGIN_ATTEMPT_TTL_S,
  loginAttemptCookieOptions,
  sanitizeReturnTo,
  encodeLoginAttempt,
  decodeLoginAttempt,
  type LoginAttempt,
} from '@/lib/auth/login-attempt';

describe('login attempt cookie options', () => {
  it('is HttpOnly, SameSite=Lax, scoped to /auth, short-lived', () => {
    const opts = loginAttemptCookieOptions(false);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('lax');
    expect(opts.path).toBe(LOGIN_ATTEMPT_PATH);
    expect(opts.maxAge).toBe(LOGIN_ATTEMPT_TTL_S);
    expect(LOGIN_ATTEMPT_COOKIE).toBe('app_auth_attempt');
  });

  it('sets Secure from the boolean it is given, not from NODE_ENV', () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    try {
      env.NODE_ENV = 'production';
      expect(loginAttemptCookieOptions(true).secure).toBe(true);
      expect(loginAttemptCookieOptions(false).secure).toBe(false);
    } finally {
      env.NODE_ENV = previous;
    }
  });
});

describe('sanitizeReturnTo', () => {
  it.each(['/', '/todos', '/todos?done=false', '/notes/abc'])('accepts %j', (value) => {
    expect(sanitizeReturnTo(value)).toBe(value);
  });

  it.each([
    undefined,
    '',
    'notes',
    'https://evil.com',
    '//evil.com',
    '/\\evil.com',
    '/a\nb',
    '/' + 'a'.repeat(2048), // 2049 chars
  ])('rejects %j', (value) => {
    expect(sanitizeReturnTo(value)).toBeUndefined();
  });
});

describe('login-attempt cookie payload', () => {
  const ATTEMPT: LoginAttempt = { state: 's', nonce: 'n', codeVerifier: 'v' };

  it('round-trips a validated returnTo', () => {
    const withReturn: LoginAttempt = { ...ATTEMPT, returnTo: '/todos' };
    expect(decodeLoginAttempt(encodeLoginAttempt(withReturn))).toEqual(withReturn);
  });

  it('keeps the legacy payload shape when there is no returnTo', () => {
    expect(decodeLoginAttempt(encodeLoginAttempt(ATTEMPT))).toEqual(ATTEMPT);
  });

  it('drops an unsafe returnTo on decode', () => {
    const payload = Buffer.from(
      JSON.stringify({ ...ATTEMPT, returnTo: '//evil.com' }),
    ).toString('base64url');
    const decoded = decodeLoginAttempt(payload);
    expect(decoded).toEqual(ATTEMPT);
    expect(decoded).not.toHaveProperty('returnTo');
  });
});
