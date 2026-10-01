import { settingsHref } from '../src/settings-route';
import {
  prefCookieName,
  parsePrefValue,
  readPref,
  setPref,
  settingsHref as settingsHrefFromBarrel,
} from '../src/index';
import type { PrefKey } from '../src/index';

describe('settingsHref', () => {
  it('appends the settings segment to the app-scoped route', () => {
    expect(settingsHref('/todos')).toBe('/todos/settings');
    expect(settingsHref('/notes')).toBe('/notes/settings');
  });

  it('normalizes a trailing slash so the join never yields a double slash', () => {
    const href = settingsHref('/todos/');
    expect(href).toBe('/todos/settings');
    expect(href).not.toContain('//settings');
  });

  it('is exported from the barrel beside the other settings names', () => {
    expect(typeof settingsHrefFromBarrel).toBe('function');
    expect(typeof prefCookieName).toBe('function');
    expect(typeof parsePrefValue).toBe('function');
    expect(typeof readPref).toBe('function');
    expect(typeof setPref).toBe('function');
    const key: PrefKey = 'pref';
    expect(typeof key).toBe('string');
  });
});
