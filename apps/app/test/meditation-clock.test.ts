import {
  bellScheduleFor,
  cappedMinutes,
  formatClock,
  goalProgressLine,
  minuteUnit,
  remainingSeconds,
} from '@/lib/meditation-clock';

/**
 * The `/meditation` screens' arithmetic (`SPEC-meditation-app` §5, §6): the clock, the minutes an
 * early stop records, the goal sentence, and the schedule a sitting rings from.
 *
 * The rounding rule is asserted at its three edges because the stop dialog shows the number the
 * write will carry — off-by-one here is a saved sitting that says the wrong thing.
 */

const SECONDS_PER_MINUTE = 60;

describe('formatClock', () => {
  it('reads minutes and seconds below an hour', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(59)).toBe('0:59');
    expect(formatClock(600)).toBe('10:00');
  });

  it('reads hours once the sitting runs past one', () => {
    expect(formatClock(3600)).toBe('1:00:00');
    expect(formatClock(3725)).toBe('1:02:05');
  });

  it('rounds a part second up, so a running clock never reads 0:00', () => {
    expect(formatClock(0.2)).toBe('0:01');
  });

  it('never counts below zero', () => {
    expect(formatClock(-5)).toBe('0:00');
  });
});

describe('minuteUnit', () => {
  it('keeps a single minute singular', () => {
    expect(`${1} ${minuteUnit(1)}`).toBe('1 minute');
    expect(`${0} ${minuteUnit(0)}`).toBe('0 minutes');
  });
});

describe('remainingSeconds', () => {
  it('counts down from the planned length', () => {
    const startedAtMs = 1_000_000;
    expect(remainingSeconds({ startedAtMs, nowMs: startedAtMs + 60_000, plannedMinutes: 15 })).toBe(
      14 * SECONDS_PER_MINUTE,
    );
  });

  it('stops at zero rather than going negative', () => {
    expect(remainingSeconds({ startedAtMs: 0, nowMs: 1_000_000, plannedMinutes: 1 })).toBe(0);
  });
});

describe('cappedMinutes', () => {
  it('rounds elapsed time up, so a minute begun is a minute sat', () => {
    expect(cappedMinutes(30, 15)).toBe(1);
    expect(cappedMinutes(61, 15)).toBe(2);
  });

  it('floors at one minute even before any time has passed', () => {
    expect(cappedMinutes(0, 15)).toBe(1);
  });

  it('never records more than was planned', () => {
    expect(cappedMinutes(3600, 15)).toBe(15);
  });

  it('lands on the elapsed minutes between the two bounds', () => {
    expect(cappedMinutes(600, 15)).toBe(10);
  });
});

describe('goalProgressLine', () => {
  it('says nothing has happened yet on a zero day', () => {
    expect(goalProgressLine({ liveMinutes: 0, goalMinutes: 15 })).toBe(
      'Nothing yet today · goal 15 minutes',
    );
  });

  it('says what is left on a partway day', () => {
    expect(goalProgressLine({ liveMinutes: 10, goalMinutes: 15 })).toBe(
      '10 of 15 minutes today · 5 minutes to go',
    );
  });

  it('says the goal is met at exactly the goal, not only past it', () => {
    expect(goalProgressLine({ liveMinutes: 15, goalMinutes: 15 })).toBe(
      'Goal met · 15 minutes today, against a goal of 15 minutes',
    );
  });
});

describe('bellScheduleFor', () => {
  const bells = { enabled: true, offsetSec: 60, intervalSec: 600, repeat: null };

  it('spans the planned length, in seconds', () => {
    expect(bellScheduleFor(bells, 15)).toEqual({
      durationSec: 15 * SECONDS_PER_MINUTE,
      offsetSec: 60,
      intervalSec: 600,
      repeat: null,
    });
  });

  it('rings nothing when the bells are switched off', () => {
    expect(bellScheduleFor({ ...bells, enabled: false }, 15)).toBeNull();
  });
});
