import { repeatLabel } from '../lib/todo-repeat-label';

describe('repeatLabel', () => {
  it('renders all five repeat options with the due date made self-describing', () => {
    // 2026-10-01 is a Thursday, the 1st, in October.
    expect(repeatLabel('daily', '2026-10-01')).toBe('Daily');
    expect(repeatLabel('weekdays', '2026-10-01')).toBe('Every Weekday (Mon - Fri)');
    expect(repeatLabel('weekly', '2026-10-01')).toBe('Weekly (Thursday)');
    expect(repeatLabel('monthly', '2026-10-01')).toBe('Monthly (The 1st day)');
    expect(repeatLabel('yearly', '2026-10-01')).toBe('Yearly (1 Oct)');
  });

  it('reads the due date from an ISO datetime too', () => {
    expect(repeatLabel('yearly', '2026-12-31T09:00:00.000Z')).toBe('Yearly (31 Dec)');
  });

  it('uses the correct ordinal suffix', () => {
    expect(repeatLabel('monthly', '2026-10-11')).toBe('Monthly (The 11th day)');
    expect(repeatLabel('monthly', '2026-10-21')).toBe('Monthly (The 21st day)');
    expect(repeatLabel('monthly', '2026-10-22')).toBe('Monthly (The 22nd day)');
    expect(repeatLabel('monthly', '2026-10-23')).toBe('Monthly (The 23rd day)');
    expect(repeatLabel('monthly', '2026-10-31')).toBe('Monthly (The 31st day)');
  });

  it('returns null for no repeat', () => {
    expect(repeatLabel(null, '2026-10-01')).toBeNull();
    expect(repeatLabel(null)).toBeNull();
  });

  it('renders a custom repeat with its sorted weekday set', () => {
    // Tue is [2]; 2026-10-01 is a Thursday.
    expect(repeatLabel('custom', '2026-10-01', [4, 5])).toBe('Custom (Thu, Fri)');
    expect(repeatLabel('custom', '2026-10-01', [2])).toBe('Custom (Tue)');
    expect(repeatLabel('custom', '2026-10-01', [5, 4])).toBe('Custom (Thu, Fri)');
  });

  it('falls back to the bare Custom label for no/empty custom days', () => {
    expect(repeatLabel('custom', '2026-10-01', [])).toBe('Custom');
    expect(repeatLabel('custom', '2026-10-01', null)).toBe('Custom');
    expect(repeatLabel('custom')).toBe('Custom');
  });

  it('falls back to the bare base label when the due date is missing or malformed', () => {
    expect(repeatLabel('weekly')).toBe('Weekly');
    expect(repeatLabel('weekly', null)).toBe('Weekly');
    expect(repeatLabel('monthly', '')).toBe('Monthly');
    expect(repeatLabel('yearly', 'not a date')).toBe('Yearly');
    // The static options never carry a parenthetical.
    expect(repeatLabel('daily', null)).toBe('Daily');
    expect(repeatLabel('weekdays', null)).toBe('Every Weekday (Mon - Fri)');
  });
});
