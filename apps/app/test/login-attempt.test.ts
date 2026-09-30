/**
 * The per-attempt cookie may carry a `returnTo` path back to the requested page
 * after auth. It is attacker-influenced (query string), so it must only ever be a
 * same-origin absolute path — the sanitizer is the single gate.
 */

import { sanitizeReturnTo, encodeLoginAttempt, decodeLoginAttempt, type LoginAttempt } from '@/lib/auth/login-attempt';

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
