import type { GoalRow, SessionRow } from '@/lib/focus-api';
import { bucketsFor, resolveGoal, windowFor, type Period } from '@/lib/stats-buckets';

/** One session row landing on `date`, the shape the service serves. */
function sessionOn(date: string, minutes: number, index = 0): SessionRow {
  return {
    id: `s-${date}-${index}`,
    ownerSub: 'owner-1',
    date,
    minutes,
    createdAt: `${date}T09:00:00.000Z`,
  };
}

/** The caller's pairing: one row per window day, zero minutes where nothing was recorded. */
function rowsForDays(days: string[], minutesOnDate: Map<string, number> = new Map()): SessionRow[] {
  return days.map((day) => sessionOn(day, minutesOnDate.get(day) ?? 0));
}

function zeroMinutes(rows: SessionRow[]): number {
  return rows.reduce((total, row) => total + row.minutes, 0);
}

const TODAY = '2026-10-28';

describe('windowFor', () => {
  it('ends week and month windows on today with 7 and 30 days', () => {
    const week = windowFor('week', 0, TODAY);
    const month = windowFor('month', 0, TODAY);

    expect(week.from).toBe('2026-10-22');
    expect(week.to).toBe(TODAY);
    expect(week.days).toHaveLength(7);
    expect(month.from).toBe('2026-09-29');
    expect(month.to).toBe(TODAY);
    expect(month.days).toHaveLength(30);
  });

  it('spans twelve whole months for a year window', () => {
    const year = windowFor('year', 0, TODAY);

    expect(year.from).toBe('2025-11-01');
    expect(year.to).toBe(TODAY);
    expect(year.days[0]).toBe('2025-11-01');
    expect(year.days[year.days.length - 1]).toBe(TODAY);
  });

  it('shifts one whole period back without changing the day count', () => {
    for (const period of ['week', 'month'] as const) {
      const current = windowFor(period, 0, TODAY);
      const shifted = windowFor(period, 1, TODAY);

      expect(shifted.days).toHaveLength(current.days.length);
      expect(shifted.days[shifted.days.length - 1]).toBe(shifted.to);
      expect(shifted.to < current.from).toBe(true);
    }

    expect(windowFor('week', 1, TODAY).to).toBe('2026-10-21');
    expect(windowFor('week', 1, TODAY).from).toBe('2026-10-15');
    expect(windowFor('month', 1, TODAY).from).toBe('2026-08-30');
  });

  it('crosses a month and a year boundary without a Date round trip', () => {
    expect(windowFor('week', 1, '2026-03-03').from).toBe('2026-02-18');
    expect(windowFor('week', 0, '2026-01-03').days).toHaveLength(7);
    expect(windowFor('week', 1, '2026-01-03').from).toBe('2025-12-21');
    expect(windowFor('month', 0, '2024-03-01').from).toBe('2024-02-01');
  });

  it('ends a shifted year window on the last day of its final month', () => {
    const shifted = windowFor('year', 1, TODAY);

    expect(shifted.from).toBe('2024-11-01');
    expect(shifted.to).toBe('2025-10-31');
  });
});

describe('bucketsFor — bucket counts', () => {
  const expectedCounts: Record<Period, number> = { week: 7, month: 30, year: 12 };

  it('draws 7, 30, and 12 buckets for a window paired one row per day', () => {
    for (const [period, count] of Object.entries(expectedCounts) as [Period, number][]) {
      const window = windowFor(period, 0, TODAY);

      const buckets = bucketsFor(period, rowsForDays(window.days), []);

      expect(buckets).toHaveLength(count);
      expect(zeroMinutes(rowsForDays(window.days))).toBe(0);
    }
  });

  it('draws the full strip for a window whose every day is a zero-minute row', () => {
    const window = windowFor('month', 0, TODAY);

    const buckets = bucketsFor('month', rowsForDays(window.days), []);

    expect(buckets).toHaveLength(30);
    expect(buckets.every((bucket) => bucket.value === 0)).toBe(true);
  });

  it('ends the last bucket on today and starts on the window first day', () => {
    const week = windowFor('week', 0, TODAY);
    const buckets = bucketsFor('week', rowsForDays(week.days), []);

    expect(buckets[0].label).toBe('22 Oct');
    expect(buckets[buckets.length - 1].label).toBe('28 Oct');
  });

  it('keeps the bucket count on a window shifted one period back', () => {
    for (const [period, count] of Object.entries(expectedCounts) as [Period, number][]) {
      const shifted = windowFor(period, 1, TODAY);

      expect(bucketsFor(period, rowsForDays(shifted.days), [])).toHaveLength(count);
    }
  });
});

describe('bucketsFor — minutes land in their own bucket', () => {
  it('sums several sessions of one day into that day only', () => {
    const week = windowFor('week', 0, TODAY);
    const rows = [
      ...rowsForDays(week.days),
      sessionOn('2026-10-26', 25, 1),
      sessionOn('2026-10-26', 20, 2),
      sessionOn('2026-10-28', 30, 1),
    ];

    const buckets = bucketsFor('week', rows, []);
    const values = buckets.map((bucket) => bucket.value);

    expect(values).toEqual([0, 0, 0, 0, 45, 0, 30]);
  });

  it('counts a session on the first and last day of the window', () => {
    const month = windowFor('month', 0, TODAY);
    const rows = [
      ...rowsForDays(month.days),
      sessionOn(month.from, 12, 1),
      sessionOn(month.to, 8, 1),
    ];

    const buckets = bucketsFor('month', rows, []);

    expect(buckets[0].value).toBe(12);
    expect(buckets[buckets.length - 1].value).toBe(8);
    expect(buckets.slice(1, -1).every((bucket) => bucket.value === 0)).toBe(true);
  });

  it('sums a month bucket over its days and leaves months outside the window out', () => {
    const rows = [
      ...rowsForDays(windowFor('year', 0, TODAY).days),
      sessionOn('2026-10-01', 25, 1),
      sessionOn('2025-11-02', 15, 1),
    ];

    const buckets = bucketsFor('year', rows, []);

    expect(buckets).toHaveLength(12);
    expect(buckets[0]).toMatchObject({ label: 'Nov 2025', value: 15 });
    expect(buckets[buckets.length - 1]).toMatchObject({ label: 'Oct 2026', value: 25 });
    expect(zeroMinutes(rows)).toBe(40);
  });
});

describe('resolveGoal — the locked day→goal rule', () => {
  const goals: GoalRow[] = [
    { validFrom: '2026-10-01', minutes: 30 },
    { validFrom: '2026-10-20', minutes: 40 },
  ];

  it('answers the newest row that took effect on or before the day', () => {
    expect(resolveGoal(goals, '2026-10-28')).toBe(40);
    expect(resolveGoal(goals, '2026-10-20')).toBe(40);
    expect(resolveGoal(goals, '2026-10-19')).toBe(30);
  });

  it('answers null before every row instead of a default goal', () => {
    expect(resolveGoal(goals, '2026-09-30')).toBeNull();
    expect(resolveGoal([], TODAY)).toBeNull();
  });
});

describe('bucketsFor — goal targets', () => {
  it('carries a daily bucket’s own day goal and leaves earlier days undefined', () => {
    const week = windowFor('week', 0, TODAY);
    const goals: GoalRow[] = [{ validFrom: '2026-10-25', minutes: 40 }];

    const buckets = bucketsFor('week', rowsForDays(week.days), goals);

    expect(buckets.map((bucket) => bucket.target)).toEqual([
      undefined,
      undefined,
      undefined,
      40,
      40,
      40,
      40,
    ]);
  });

  it('sums a month bucket’s resolved daily goals', () => {
    const goals: GoalRow[] = [
      { validFrom: '2026-09-01', minutes: 30 },
      { validFrom: '2026-10-26', minutes: 40 },
    ];

    const buckets = bucketsFor('year', rowsForDays(windowFor('year', 0, TODAY).days), goals);

    const october = buckets[buckets.length - 1];
    expect(october.label).toBe('Oct 2026');
    // 25 days of September's 30-minute goal (1–25 Oct) plus 3 days at 40 (26–28 Oct).
    expect(october.target).toBe(25 * 30 + 3 * 40);

    const september = buckets[buckets.length - 2];
    expect(september.label).toBe('Sep 2026');
    expect(september.target).toBe(30 * 30);
  });

  it('sums each month’s daily goal once even when a day carries several sessions', () => {
    const month = windowFor('month', 0, TODAY);
    const goals: GoalRow[] = [{ validFrom: month.from, minutes: 20 }];
    const rows = [...rowsForDays(month.days), sessionOn('2026-10-27', 25, 1)];

    const buckets = bucketsFor('month', rows, goals);

    expect(buckets.every((bucket) => bucket.target === 20)).toBe(true);
  });

  it('leaves target undefined for a month with no applicable goal row', () => {
    const goals: GoalRow[] = [{ validFrom: '2026-10-01', minutes: 30 }];

    const buckets = bucketsFor('year', rowsForDays(windowFor('year', 0, TODAY).days), goals);

    expect(buckets[0].target).toBeUndefined();
    expect(buckets[buckets.length - 1].target).toBe(30 * 28);
  });
});
