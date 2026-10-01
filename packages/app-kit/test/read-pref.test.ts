import { cookieGet, cookieState, cookieStore } from './stubs/next-headers';
import { readPref } from '../src/preferences';

beforeEach(() => {
  for (const key of Object.keys(cookieStore)) {
    delete cookieStore[key];
  }
  cookieState.throws = false;
  cookieGet.mockClear();
});

describe('readPref', () => {
  it('reads an "on" cookie as true and asks for pref_<key>', async () => {
    cookieStore['pref_matrix'] = 'on';
    await expect(readPref('matrix')).resolves.toBe(true);
    expect(cookieGet).toHaveBeenCalledWith('pref_matrix');
  });

  it('returns false when the cookie is absent', async () => {
    await expect(readPref('matrix')).resolves.toBe(false);
  });

  it('returns false for malformed values', async () => {
    for (const raw of ['ON', 'yes', 'off', '']) {
      cookieStore['pref_matrix'] = raw;
      await expect(readPref('matrix')).resolves.toBe(false);
    }
  });

  it('never throws when the cookie store errors', async () => {
    cookieState.throws = true;
    await expect(readPref('matrix')).resolves.toBe(false);
  });
});
