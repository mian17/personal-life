import {
  MAX_WINDOW_DAYS,
  canBeFiledOn,
  dayDoneWindow,
  daysBetween,
  goalReached,
  liveMinutesOn,
  windowDayCount,
  type SittingMinutes,
} from '../src/sessions/day-done.js';

/**
 * The day-done derivation (`SPEC-meditation-app` §1, §5, §8 criterion 2) at its exact edges:
 * a day reads done when its live minutes reach the goal and not one minute earlier, a stamped
 * sitting never reaches its day, and the same rows answer differently when the goal moves.
 */

/** Minutes sat on `day`, as a decrypted sitting row hands them over. */
function sitting(day: string, minutes: number, deletedAt: string | null = null): SittingMinutes {
  return { day, minutes, deletedAt };
}

describe('goalReached', () => {
  it('counts a day that sat exactly the goal as reaching it', () => {
    expect(goalReached(30, 30)).toBe(true);
  });

  it('rejects a day one minute short of the goal', () => {
    expect(goalReached(29, 30)).toBe(false);
  });

  it('counts a day past the goal as reaching it', () => {
    expect(goalReached(31, 30)).toBe(true);
  });
});

describe('daysBetween', () => {
  it('holds every calendar day of a closed window, in order', () => {
    expect(daysBetween({ from: '2026-11-14', to: '2026-11-16' })).toEqual([
      '2026-11-14',
      '2026-11-15',
      '2026-11-16',
    ]);
  });

  it('holds one day when both bounds are that day', () => {
    expect(daysBetween({ from: '2026-11-16', to: '2026-11-16' })).toEqual(['2026-11-16']);
  });

  it('crosses a month boundary without losing or repeating a day', () => {
    expect(daysBetween({ from: '2026-10-30', to: '2026-11-02' })).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });

  it('holds no day when the window is reversed', () => {
    expect(daysBetween({ from: '2026-11-16', to: '2026-11-14' })).toEqual([]);
  });
});

describe('liveMinutesOn', () => {
  it('sums the live sittings of the asked day only', () => {
    const sittings = [
      sitting('2026-11-16', 15),
      sitting('2026-11-16', 10),
      sitting('2026-11-15', 45),
    ];

    expect(liveMinutesOn('2026-11-16', sittings)).toBe(25);
  });

  it('leaves a stamped sitting out of its day', () => {
    const sittings = [
      sitting('2026-11-16', 15),
      sitting('2026-11-16', 15, '2026-11-16T09:00:00.000Z'),
    ];

    expect(liveMinutesOn('2026-11-16', sittings)).toBe(15);
  });
});

describe('dayDoneWindow', () => {
  const days = daysBetween({ from: '2026-11-15', to: '2026-11-17' });

  it('marks the day exactly at the goal done and the day one minute short not done', () => {
    const sittings = [sitting('2026-11-15', 30), sitting('2026-11-16', 29)];

    const window = dayDoneWindow({ days, sittings, goalMinutes: 30 });

    expect(window.map((day) => [day.date, day.liveMinutes, day.done])).toEqual([
      ['2026-11-15', 30, true],
      ['2026-11-16', 29, false],
      ['2026-11-17', 0, false],
    ]);
  });

  it('keeps a day it reaches only through a stamped sitting not done', () => {
    const sittings = [
      sitting('2026-11-15', 15),
      sitting('2026-11-15', 15, '2026-11-15T09:00:00.000Z'),
    ];

    const [day] = dayDoneWindow({ days: ['2026-11-15'], sittings, goalMinutes: 30 });

    expect(day).toEqual({ date: '2026-11-15', liveMinutes: 15, goalMinutes: 30, done: false });
  });

  it('re-measures the same rows against a raised goal, with no write', () => {
    const sittings = [sitting('2026-11-15', 30)];

    const before = dayDoneWindow({ days: ['2026-11-15'], sittings, goalMinutes: 30 });
    const after = dayDoneWindow({ days: ['2026-11-15'], sittings, goalMinutes: 45 });

    expect(before[0].done).toBe(true);
    expect(after[0]).toEqual({ date: '2026-11-15', liveMinutes: 30, goalMinutes: 45, done: false });
  });
});

describe('windowDayCount', () => {
  it('counts both ends of a closed window', () => {
    expect(windowDayCount({ from: '2026-11-14', to: '2026-11-16' })).toBe(3);
    expect(windowDayCount({ from: '2026-11-14', to: '2026-11-14' })).toBe(1);
  });

  it('measures a decade as one number instead of enumerating it', () => {
    expect(windowDayCount({ from: '0000-01-01', to: '9999-12-31' })).toBeGreaterThan(
      MAX_WINDOW_DAYS,
    );
  });

  it('counts a reversed window as nothing, so the reversal check owns that refusal', () => {
    expect(windowDayCount({ from: '2026-11-16', to: '2026-11-14' })).toBe(0);
  });
});

describe('canBeFiledOn', () => {
  it('takes the day a sitting ended on, in the same clock', () => {
    expect(canBeFiledOn('2026-11-16', '2026-11-16T06:15:00.000Z')).toBe(true);
  });

  it('allows the one calendar day a local clock can sit from the UTC date', () => {
    expect(canBeFiledOn('2026-11-17', '2026-11-16T23:30:00.000Z')).toBe(true);
    expect(canBeFiledOn('2026-11-15', '2026-11-16T00:30:00.000Z')).toBe(true);
  });

  it('refuses a sitting filed on a day it never ran on', () => {
    expect(canBeFiledOn('2026-11-14', '2026-11-16T06:15:00.000Z')).toBe(false);
    expect(canBeFiledOn('2026-11-14', 'not-a-date')).toBe(false);
  });
});
