import { todayIso } from '../src/components/due-date-pill';
import { dueDay, localTimePart } from '../src/lib/date-parts';
import { dueDateLabel, formatDate } from '../src/lib/format-date';

describe('formatDate', () => {
  it('renders dd/mm/yyyy with the full year', () => {
    expect(formatDate('2026-10-01')).toBe('01/10/2026');
  });

  it('zero-pads day and month', () => {
    expect(formatDate('2026-01-05')).toBe('05/01/2026');
    expect(formatDate('2026-11-09')).toBe('09/11/2026');
  });

  it('takes the written date part of an ISO datetime', () => {
    expect(formatDate('2026-09-27T12:34:56.000Z')).toBe('27/09/2026');
    expect(formatDate('2026-12-31T23:59:59.999+02:00')).toBe('31/12/2026');
  });

  it('renders empty input as an empty string', () => {
    expect(formatDate('')).toBe('');
  });

  it('renders invalid input as an empty string', () => {
    expect(formatDate('not a date')).toBe('');
    expect(formatDate('2026-13-45')).toBe('');
    expect(formatDate('2026-02-31')).toBe('');
    expect(formatDate('12:34')).toBe('');
  });

  it('does not drift the day in a negative-offset timezone', () => {
    const iso = '2026-10-01T00:00:00.000Z';
    // Naive local rendering at UTC-7 lands on the previous day...
    expect(new Date(iso).toLocaleDateString('en-GB', { timeZone: 'America/Los_Angeles' })).toBe(
      '30/09/2026',
    );
    // ...while the helper reads the calendar parts as written.
    expect(formatDate(iso)).toBe('01/10/2026');
  });
});

describe('dueDateLabel', () => {
  it('renders No date for null and empty input', () => {
    expect(dueDateLabel(null, '2026-09-28')).toBe('No date');
    expect(dueDateLabel('', '2026-09-28')).toBe('No date');
  });

  it('renders Today for the injected date', () => {
    expect(dueDateLabel('2026-09-28', '2026-09-28')).toBe('Today');
  });

  it('renders Tomorrow for the day after the injected date', () => {
    expect(dueDateLabel('2026-09-29', '2026-09-28')).toBe('Tomorrow');
  });

  it('rolls Tomorrow across a month boundary', () => {
    expect(dueDateLabel('2026-10-01', '2026-09-30')).toBe('Tomorrow');
    expect(dueDateLabel('2027-01-01', '2026-12-31')).toBe('Tomorrow');
  });

  it('renders dd/mm/yyyy otherwise', () => {
    expect(dueDateLabel('2026-09-27', '2026-09-28')).toBe('27/09/2026');
    expect(dueDateLabel('2026-10-05', '2026-09-28')).toBe('05/10/2026');
  });

  it('defaults today to the real local date', () => {
    expect(dueDateLabel(todayIso())).toBe('Today');
    expect(dueDateLabel(null)).toBe('No date');
  });

  it('renders a local HH:mm suffix for a timed value', () => {
    const timed = (y: number, m: number, d: number, hh: number, mm: number) =>
      new Date(y, m - 1, d, hh, mm).toISOString();

    expect(dueDateLabel(timed(2026, 9, 28, 9, 30), '2026-09-28')).toBe('Today 09:30');
    expect(dueDateLabel(timed(2026, 9, 29, 14, 5), '2026-09-28')).toBe('Tomorrow 14:05');
    expect(dueDateLabel(timed(2026, 10, 5, 8, 0), '2026-09-28')).toBe('05/10/2026 08:00');
  });

  it('leaves a date-only value byte-identical in shape', () => {
    expect(dueDateLabel('2026-09-28', '2026-09-28')).toBe('Today');
    expect(dueDateLabel('2026-09-27', '2026-09-28')).toBe('27/09/2026');
  });
});

describe('dueDay', () => {
  it('returns a date-only value as written without a Date round-trip', () => {
    expect(dueDay('2026-10-01')).toBe('2026-10-01');
  });

  it('returns the local day of a timed instant', () => {
    expect(dueDay(new Date(2026, 8, 28, 23, 30).toISOString())).toBe('2026-09-28');
    expect(dueDay(new Date(2026, 8, 29, 0, 30).toISOString())).toBe('2026-09-29');
  });

  it('returns an empty string for missing or malformed values', () => {
    expect(dueDay(null)).toBe('');
    expect(dueDay(undefined)).toBe('');
    expect(dueDay('')).toBe('');
    expect(dueDay('not a date')).toBe('');
    expect(dueDay('2026-02-31')).toBe('');
  });
});

describe('localTimePart', () => {
  it('returns the local HH:mm for a timed value', () => {
    expect(localTimePart(new Date(2026, 8, 28, 9, 30).toISOString())).toBe('09:30');
    expect(localTimePart(new Date(2026, 8, 28, 23, 5).toISOString())).toBe('23:05');
  });

  it('returns an empty string for date-only, missing or malformed values', () => {
    expect(localTimePart('2026-09-28')).toBe('');
    expect(localTimePart(null)).toBe('');
    expect(localTimePart('')).toBe('');
    expect(localTimePart('not a date')).toBe('');
  });
});
