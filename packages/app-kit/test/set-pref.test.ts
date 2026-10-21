import { revalidatePath } from 'next/cache';
import { setPref } from '../src/preference-action';

const mockSet = jest.fn();
const revalidatePathMock = revalidatePath as unknown as jest.Mock;
const env = process.env as Record<string, string | undefined>;

jest.mock('next/headers', () => ({
  cookies: async () => ({ set: mockSet }),
}));

beforeEach(() => {
  mockSet.mockClear();
  revalidatePathMock.mockClear();
});

describe('setPref', () => {
  it('writes "on" to pref_<key> with the preference cookie attributes', async () => {
    await setPref('matrix', true);
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith('pref_matrix', 'on', {
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
      secure: true,
      maxAge: 365 * 24 * 60 * 60,
    });
  });

  it('writes "off" when the value is false', async () => {
    await setPref('matrix', false);
    expect(mockSet).toHaveBeenCalledWith(
      'pref_matrix',
      'off',
      expect.objectContaining({ maxAge: 31536000 }),
    );
  });

  it('revalidates the app layout once per write', async () => {
    await setPref('matrix', true);
    expect(revalidatePathMock).toHaveBeenCalledTimes(1);
    expect(revalidatePathMock).toHaveBeenCalledWith('/', 'layout');
  });

  it('drops Secure only on the dev stack, never because of NODE_ENV', async () => {
    const previousFlag = env.APP_DEV_SKIP_ACCESS_GATE;
    const previousNodeEnv = env.NODE_ENV;
    try {
      env.NODE_ENV = 'production';
      env.APP_DEV_SKIP_ACCESS_GATE = '1';
      await setPref('matrix', true);
      expect(mockSet).toHaveBeenLastCalledWith(
        'pref_matrix',
        'on',
        expect.objectContaining({ secure: false }),
      );

      delete env.APP_DEV_SKIP_ACCESS_GATE;
      await setPref('matrix', true);
      expect(mockSet).toHaveBeenLastCalledWith(
        'pref_matrix',
        'on',
        expect.objectContaining({ secure: true }),
      );
    } finally {
      env.NODE_ENV = previousNodeEnv;
      if (previousFlag === undefined) delete env.APP_DEV_SKIP_ACCESS_GATE;
      else env.APP_DEV_SKIP_ACCESS_GATE = previousFlag;
    }
  });
});
