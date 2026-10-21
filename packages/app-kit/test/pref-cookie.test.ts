import { parsePrefValue, prefCookieName, preferenceCookieAttributes } from '../src/preferences';

describe('preferenceCookieAttributes', () => {
  it('carries the caller’s Secure flag and the fixed preference attributes', () => {
    expect(preferenceCookieAttributes(false)).toEqual({
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
      secure: false,
      maxAge: 365 * 24 * 60 * 60,
    });
    expect(preferenceCookieAttributes(true).secure).toBe(true);
  });
});

describe('prefCookieName', () => {
  it('prefixes the preference key with pref_', () => {
    expect(prefCookieName('matrix')).toBe('pref_matrix');
  });
});

describe('parsePrefValue', () => {
  it('treats exactly "on" as true', () => {
    expect(parsePrefValue('on')).toBe(true);
  });

  it('treats off, absent and malformed values as false', () => {
    for (const raw of ['off', undefined, '', 'ON', '1', 'true']) {
      expect(parsePrefValue(raw)).toBe(false);
    }
  });
});
