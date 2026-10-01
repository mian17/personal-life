import { parsePrefValue, prefCookieName } from '../src/preferences';

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
