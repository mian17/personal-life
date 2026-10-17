import { FALLBACK_TZ, TZ_COOKIE, getDefaultMealGroup, hourInZone, mealGroupForHour } from '@/lib/today';

jest.mock('next/headers', () => ({ cookies: jest.fn() }));

import { cookies } from 'next/headers';

const mockedCookies = cookies as jest.Mock;

function withZone(zone?: string) {
  mockedCookies.mockResolvedValue({
    get: (name: string) =>
      name === TZ_COOKIE && zone !== undefined ? { value: zone } : undefined,
  });
}

describe('mealGroupForHour', () => {
  it.each([
    [4, 'snack'],
    [5, 'breakfast'],
    [10, 'breakfast'],
    [11, 'lunch'],
    [14, 'lunch'],
    [15, 'dinner'],
    [19, 'dinner'],
    [20, 'snack'],
    [23, 'snack'],
    [0, 'snack'],
  ] as const)('maps hour %i to %s', (hour, group) => {
    expect(mealGroupForHour(hour)).toBe(group);
  });
});

describe('the client clock decides the group', () => {
  // The spec's clock boundaries, read in a fixed zone: 04:59 is still a snack,
  // 05:00 turns breakfast over, and so on through the day.
  it.each([
    ['2026-10-02T04:59:00Z', 'snack'],
    ['2026-10-02T05:00:00Z', 'breakfast'],
    ['2026-10-02T10:59:00Z', 'breakfast'],
    ['2026-10-02T11:00:00Z', 'lunch'],
    ['2026-10-02T14:59:00Z', 'lunch'],
    ['2026-10-02T15:00:00Z', 'dinner'],
    ['2026-10-02T19:59:00Z', 'dinner'],
    ['2026-10-02T20:00:00Z', 'snack'],
    ['2026-10-02T23:59:00Z', 'snack'],
  ] as const)('reads %s as %s in UTC', (instant, group) => {
    expect(mealGroupForHour(hourInZone('UTC', new Date(instant)))).toBe(group);
  });

  it('shifts the hour with the zone: 04:30 UTC is breakfast in Hanoi, not the host hour', () => {
    const instant = new Date('2026-10-02T04:30:00Z');

    expect(hourInZone('UTC', instant)).toBe(4);
    expect(hourInZone('Asia/Ho_Chi_Minh', instant)).toBe(11);
    expect(mealGroupForHour(hourInZone('Asia/Ho_Chi_Minh', instant))).toBe('lunch');
  });
});

describe('getDefaultMealGroup', () => {
  const NOW = new Date('2026-10-02T04:30:00Z');

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    withZone('Asia/Ho_Chi_Minh');
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('derives the group from the cookie zone, not the host clock', async () => {
    expect(await getDefaultMealGroup()).toBe('lunch');
  });

  it('falls back to the national zone when the tz cookie is missing', async () => {
    withZone(undefined);

    expect(await getDefaultMealGroup()).toBe(mealGroupForHour(hourInZone(FALLBACK_TZ, NOW)));
  });

  it('falls back to the host hour outside a request scope (cookies() rejects)', async () => {
    mockedCookies.mockRejectedValue(new Error('outside request scope'));

    expect(await getDefaultMealGroup()).toBe(mealGroupForHour(NOW.getHours()));
  });
});
