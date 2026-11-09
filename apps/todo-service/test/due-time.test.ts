import {
  ISO_DUE,
  dueSortKey,
  localToUtc,
  reminderLocal,
  utcToLocal,
  zoneOffsetMs,
} from '../src/todos/due-time.js';

describe('due-time: ISO_DUE shape', () => {
  it('accepts date-only and timed values, rejects anything else', () => {
    expect(ISO_DUE.test('2026-03-08')).toBe(true);
    expect(ISO_DUE.test('2026-03-08T02:30')).toBe(true);
    expect(ISO_DUE.test('2026-03-08T2:30')).toBe(false);
    expect(ISO_DUE.test('2026-03-08 02:30')).toBe(false);
    expect(ISO_DUE.test('2026-3-08')).toBe(false);
    expect(ISO_DUE.test('')).toBe(false);
  });
});

describe('due-time: Asia/Ho_Chi_Minh fixed +07:00', () => {
  const tz = 'Asia/Ho_Chi_Minh';

  it('reports a constant +7h offset', () => {
    expect(zoneOffsetMs(new Date('2026-03-08T00:00:00.000Z'), tz)).toBe(7 * 3_600_000);
    expect(zoneOffsetMs(new Date('2026-11-01T00:00:00.000Z'), tz)).toBe(7 * 3_600_000);
  });

  it('converts a local wall clock to the canonical instant and back', () => {
    const utc = localToUtc('2026-03-08T02:30', tz);
    expect(utc.toISOString()).toBe('2026-03-07T19:30:00.000Z');
    expect(utcToLocal(utc, tz)).toEqual({ y: 2026, m: 3, d: 8, hh: 2, mm: 30 });
  });
});

describe('due-time: America/New_York DST boundaries', () => {
  const tz = 'America/New_York';

  it('pins the spring-forward instant (local 2026-03-08T02:30)', () => {
    expect(localToUtc('2026-03-08T02:30', tz).toISOString()).toBe('2026-03-08T06:30:00.000Z');
    // 02:30 does not exist; the resolved instant reads back as 01:30 EST.
    expect(utcToLocal(localToUtc('2026-03-08T02:30', tz), tz)).toEqual({
      y: 2026,
      m: 3,
      d: 8,
      hh: 1,
      mm: 30,
    });
    // After the transition the offset is EDT (-4h).
    expect(zoneOffsetMs(new Date('2026-03-08T07:30:00.000Z'), tz)).toBe(-4 * 3_600_000);
  });

  it('pins the fall-back instant (local 2026-11-01T01:30)', () => {
    expect(localToUtc('2026-11-01T01:30', tz).toISOString()).toBe('2026-11-01T05:30:00.000Z');
    // The repeated wall clock resolves to the first (EDT, -4h) occurrence.
    expect(zoneOffsetMs(new Date('2026-11-01T05:30:00.000Z'), tz)).toBe(-4 * 3_600_000);
    expect(utcToLocal(new Date('2026-11-01T06:30:00.000Z'), tz)).toEqual({
      y: 2026,
      m: 11,
      d: 1,
      hh: 1,
      mm: 30,
    });
  });

  it('keeps fixed offsets either side of the transition', () => {
    expect(zoneOffsetMs(new Date('2026-01-15T12:00:00.000Z'), tz)).toBe(-5 * 3_600_000);
    expect(zoneOffsetMs(new Date('2026-07-15T12:00:00.000Z'), tz)).toBe(-4 * 3_600_000);
  });
});

describe('due-time: sort keys', () => {
  const tz = 'Asia/Ho_Chi_Minh';

  it('never converts a date-only value', () => {
    expect(dueSortKey('2026-03-08', tz)).toBe('2026-03-08');
  });

  it('sorts an undated todo last with `~`', () => {
    expect(dueSortKey(null, tz)).toBe('~');
  });

  it('maps a timed canonical instant to its local string', () => {
    expect(dueSortKey('2026-03-07T19:30:00.000Z', tz)).toBe('2026-03-08T02:30');
  });
});

describe('due-time: reminder default', () => {
  it('fires a date-only due at 09:00 local, a timed due at its own time', () => {
    expect(reminderLocal('2026-03-08')).toBe('2026-03-08T09:00');
    expect(reminderLocal('2026-03-08T02:30')).toBe('2026-03-08T02:30');
  });
});
