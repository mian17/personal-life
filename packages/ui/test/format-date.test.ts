import { todayIso } from '../src/components/due-date-pill';
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
});
