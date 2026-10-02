import {
  advanceToOnOrAfter,
  formatRepeatDays,
  nextOccurrence,
  parseRepeatDays,
} from '../src/todos/recurrence';

describe('recurrence: nextOccurrence shape and rules', () => {
  it('advances daily by one day, preserving shape', () => {
    expect(nextOccurrence('2026-03-08', 'daily')).toBe('2026-03-09');
    expect(nextOccurrence('2026-03-08T02:30', 'daily')).toBe('2026-03-09T02:30');
  });

  it('rolls a daily step across a month boundary', () => {
    expect(nextOccurrence('2026-03-31', 'daily')).toBe('2026-04-01');
  });

  it('skips the weekend for weekdays (Fri 2026-05-01 → Mon 2026-05-04)', () => {
    expect(nextOccurrence('2026-05-01', 'weekdays')).toBe('2026-05-04');
    expect(nextOccurrence('2026-05-01T09:00', 'weekdays')).toBe('2026-05-04T09:00');
  });

  it('rolls a weekdays step into the next month when the weekend crosses the month end', () => {
    // Fri 2026-10-30 → Sat 31, Sun Nov 1 → Mon 2026-11-02 (never 2026-10-32/33)
    expect(nextOccurrence('2026-10-30', 'weekdays')).toBe('2026-11-02');
    expect(nextOccurrence('2026-01-30', 'weekdays')).toBe('2026-02-02');
    expect(advanceToOnOrAfter('2026-10-30', 'weekdays', '2026-11-02')).toBe('2026-11-02');
  });

  it('advances weekly by exactly seven days', () => {
    expect(nextOccurrence('2026-03-08', 'weekly')).toBe('2026-03-15');
    expect(nextOccurrence('2026-03-08T02:30', 'weekly')).toBe('2026-03-15T02:30');
  });

  it('clamps monthly to the target month length (31st → 30th)', () => {
    expect(nextOccurrence('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(nextOccurrence('2026-03-31', 'monthly')).toBe('2026-04-30');
    expect(nextOccurrence('2026-01-31T08:00', 'monthly')).toBe('2026-02-28T08:00');
  });

  it('rolls monthly across December', () => {
    expect(nextOccurrence('2026-12-15', 'monthly')).toBe('2027-01-15');
  });

  it('clamps yearly Feb 29 to Feb 28', () => {
    expect(nextOccurrence('2024-02-29', 'yearly')).toBe('2025-02-28');
    expect(nextOccurrence('2024-02-29T10:00', 'yearly')).toBe('2025-02-28T10:00');
    expect(nextOccurrence('2026-03-08', 'yearly')).toBe('2027-03-08');
  });
});

describe('recurrence: advanceToOnOrAfter', () => {
  it('never returns a past occurrence', () => {
    expect(advanceToOnOrAfter('2026-03-01', 'daily', '2026-03-08')).toBe('2026-03-08');
    // Same-shape compare: a timed candidate keeps stepping while it is the
    // same calendar day as a later timed `nowLocal`.
    expect(advanceToOnOrAfter('2026-03-07T05:00', 'daily', '2026-03-08T05:00')).toBe(
      '2026-03-08T05:00',
    );
  });

  it('returns the same value when already on or after now', () => {
    expect(advanceToOnOrAfter('2026-03-08', 'daily', '2026-03-08')).toBe('2026-03-08');
    expect(advanceToOnOrAfter('2026-03-09', 'daily', '2026-03-08')).toBe('2026-03-09');
  });

  it('skips many steps for a weekly rule', () => {
    expect(advanceToOnOrAfter('2026-01-04', 'weekly', '2026-03-08')).toBe('2026-03-08');
  });

  it('skips weekends when advancing a weekday rule', () => {
    expect(advanceToOnOrAfter('2026-04-30', 'weekdays', '2026-05-04')).toBe('2026-05-04');
  });

  it('clamps a monthly advance while looping (clamped day sticks)', () => {
    // Jan 31 → Feb 28 (clamped) → Mar 28 → Apr 28: the clamp is per-step and
    // does not recover the 31st.
    expect(advanceToOnOrAfter('2026-01-31', 'monthly', '2026-04-01')).toBe('2026-04-28');
  });
});

describe('recurrence: custom BYDAY set', () => {
  it('steps to the next chosen day within the set (Thu → Fri)', () => {
    // 2026-10-01 is a Thursday; [4,5] is Thu+Fri.
    expect(nextOccurrence('2026-10-01', 'custom', [4, 5])).toBe('2026-10-02');
  });

  it('wraps to the next week when the set is exhausted (Fri → next Thu)', () => {
    expect(nextOccurrence('2026-10-02', 'custom', [4, 5])).toBe('2026-10-08');
  });

  it('advances a due outside the set to the next chosen day (Mon → Thu)', () => {
    // 2026-10-05 is a Monday, not in [4,5].
    expect(nextOccurrence('2026-10-05', 'custom', [4, 5])).toBe('2026-10-08');
  });

  it('behaves as daily for the full [1..7] set', () => {
    expect(nextOccurrence('2026-03-08', 'custom', [1, 2, 3, 4, 5, 6, 7])).toBe('2026-03-09');
    expect(nextOccurrence('2026-03-31', 'custom', [1, 2, 3, 4, 5, 6, 7])).toBe('2026-04-01');
  });

  it('preserves the time-of-day and the date-only/timed shape', () => {
    expect(nextOccurrence('2026-10-01T09:30', 'custom', [4, 5])).toBe('2026-10-02T09:30');
    expect(nextOccurrence('2026-10-01', 'custom', [4, 5])).toBe('2026-10-02');
  });

  it('returns the value unchanged when days is null or empty', () => {
    expect(nextOccurrence('2026-10-01', 'custom', null)).toBe('2026-10-01');
    expect(nextOccurrence('2026-10-01', 'custom', [])).toBe('2026-10-01');
  });

  it('converges on or after now and never returns a past occurrence', () => {
    expect(advanceToOnOrAfter('2026-10-01', 'custom', '2026-10-09', [4, 5])).toBe('2026-10-09');
    expect(advanceToOnOrAfter('2026-10-02', 'custom', '2026-10-02', [4, 5])).toBe('2026-10-02');
  });

  it('terminates on an empty day set, returning the input unchanged', () => {
    // Regression: an empty set makes nextOccurrence a no-op; without the
    // no-progress guard this loop would spin forever.
    expect(advanceToOnOrAfter('2026-10-08T09:00', 'custom', '2026-10-20T09:00', null)).toBe(
      '2026-10-08T09:00',
    );
    expect(advanceToOnOrAfter('2026-10-08T09:00', 'custom', '2026-10-20T09:00', [])).toBe(
      '2026-10-08T09:00',
    );
  });
});

describe('recurrence: repeatDays CSV owners', () => {
  it('formatRepeatDays sorts, de-dupes, and nulls empty input', () => {
    expect(formatRepeatDays([5, 4, 4])).toBe('4,5');
    expect(formatRepeatDays([1])).toBe('1');
    expect(formatRepeatDays(null)).toBeNull();
    expect(formatRepeatDays([])).toBeNull();
  });

  it('parseRepeatDays parses CSVs and nulls empty input', () => {
    expect(parseRepeatDays('4,5')).toEqual([4, 5]);
    expect(parseRepeatDays(null)).toBeNull();
    expect(parseRepeatDays('')).toBeNull();
  });

  it('parseRepeatDays drops out-of-range and non-integer values defensively', () => {
    expect(parseRepeatDays('4,9,0,3')).toEqual([4, 3]);
    expect(parseRepeatDays('4,x')).toEqual([4]);
  });
});
