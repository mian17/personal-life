import { todayIso, todayIsoInZone } from '@life/ui';

jest.mock('next/headers', () => ({ cookies: jest.fn() }));

import { cookies } from 'next/headers';
import { FALLBACK_TZ, TZ_COOKIE, getToday } from '@/lib/today';

const mockedCookies = cookies as jest.Mock;
const NOW = new Date('2026-10-02T17:24:00Z');

function withZone(zone?: string) {
  mockedCookies.mockResolvedValue({
    get: (name: string) =>
      name === TZ_COOKIE && zone !== undefined ? { value: zone } : undefined,
  });
}

describe('getToday', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    withZone('Asia/Ho_Chi_Minh');
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("returns the browser zone's day across the midnight boundary (lesson 0019)", async () => {
    expect(await getToday()).toBe('2026-10-03');
  });

  it('falls back to the national zone when the tz cookie is missing', async () => {
    withZone(undefined);

    expect(await getToday()).toBe(todayIsoInZone(FALLBACK_TZ, NOW));
  });

  it('falls back to the national zone when the tz cookie is an invalid zone', async () => {
    withZone('Not/AZone');

    expect(await getToday()).toBe(todayIsoInZone(FALLBACK_TZ, NOW));
  });

  it('returns the host day outside a request scope (cookies() rejects)', async () => {
    mockedCookies.mockRejectedValue(new Error('outside request scope'));

    expect(await getToday()).toBe(todayIso(NOW));
  });
});
