import { revalidatePath } from 'next/cache';
import { readPrefNumber } from '../src/preferences';
import { setPrefNumber } from '../src/preference-action';

const mockCookieStore: Record<string, string | undefined> = {};
const mockCookieState = { throws: false };
const mockGet = jest.fn((name: string) => {
  const value = mockCookieStore[name];
  return value === undefined ? undefined : { name, value };
});
const mockSet = jest.fn();
const revalidatePathMock = revalidatePath as unknown as jest.Mock;
const env = process.env as Record<string, string | undefined>;

jest.mock('next/headers', () => ({
  cookies: async () => {
    if (mockCookieState.throws) {
      throw new Error('cookies() was called outside a request scope');
    }
    return { get: mockGet, set: mockSet };
  },
}));

beforeEach(() => {
  for (const key of Object.keys(mockCookieStore)) {
    delete mockCookieStore[key];
  }
  mockCookieState.throws = false;
  mockGet.mockClear();
  mockSet.mockClear();
  revalidatePathMock.mockClear();
});

describe('readPrefNumber', () => {
  it('reads a whole number from the pref_<key> cookie', async () => {
    mockCookieStore['pref_pomodoro_focus'] = '25';
    await expect(readPrefNumber('pomodoro_focus', 25)).resolves.toBe(25);
    expect(mockGet).toHaveBeenCalledWith('pref_pomodoro_focus');
  });

  it('falls back when the cookie is absent', async () => {
    await expect(readPrefNumber('pomodoro_focus', 25)).resolves.toBe(25);
  });

  it('falls back for malformed values', async () => {
    for (const raw of ['abc', '2.5', '', '-3']) {
      mockCookieStore['pref_pomodoro_focus'] = raw;
      await expect(readPrefNumber('pomodoro_focus', 25)).resolves.toBe(25);
    }
  });

  it('never throws when the cookie store errors', async () => {
    mockCookieState.throws = true;
    await expect(readPrefNumber('pomodoro_focus', 25)).resolves.toBe(25);
  });
});

describe('setPrefNumber', () => {
  it('writes the decimal string with the preference cookie attributes', async () => {
    await setPrefNumber('pomodoro_focus', 25);
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith('pref_pomodoro_focus', '25', {
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 365 * 24 * 60 * 60,
    });
  });

  it('revalidates the app layout once per write', async () => {
    await setPrefNumber('pomodoro_focus', 25);
    expect(revalidatePathMock).toHaveBeenCalledTimes(1);
    expect(revalidatePathMock).toHaveBeenCalledWith('/', 'layout');
  });

  it('marks the cookie secure only in production', async () => {
    const previous = process.env.NODE_ENV;
    try {
      env.NODE_ENV = 'production';
      await setPrefNumber('pomodoro_focus', 25);
      expect(mockSet).toHaveBeenLastCalledWith(
        'pref_pomodoro_focus',
        '25',
        expect.objectContaining({ secure: true }),
      );

      env.NODE_ENV = 'test';
      await setPrefNumber('pomodoro_focus', 25);
      expect(mockSet).toHaveBeenLastCalledWith(
        'pref_pomodoro_focus',
        '25',
        expect.objectContaining({ secure: false }),
      );
    } finally {
      env.NODE_ENV = previous;
    }
  });
});
