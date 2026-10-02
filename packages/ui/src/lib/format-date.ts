import { datePart, dueDay, isRealDate, localTimePart, todayIso } from './date-parts';

/**
 * Shared date formatting. Every frontend date read-out renders `dd/mm/yyyy`;
 * the calendar parts are read from the ISO string itself, so a negative-offset
 * timezone can never shift the day (`2026-10-01T00:00:00Z` stays 01/10/2026 in
 * UTC-8 instead of becoming 30/09/2026).
 */

/**
 * `dd/mm/yyyy` (zero-padded day/month, full year) from an ISO date or datetime.
 * Empty or invalid input renders as `''`.
 */
export function formatDate(iso: string): string {
  const part = datePart(iso);
  if (part === '' || !isRealDate(part)) return '';
  const [year, month, day] = part.split('-');
  return `${day}/${month}/${year}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * English long weekday (`Thursday`) from an ISO date or datetime. The calendar
 * parts are read from the ISO string itself and the weekday comes from the same
 * UTC technique as `addDay`, so no host timezone can shift it. Empty/malformed → `''`.
 */
export function formatWeekday(iso: string): string {
  const part = datePart(iso);
  if (part === '' || !isRealDate(part)) return '';
  const [year, month, day] = part.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

/**
 * `<day-number> <Mon>` (`1 Oct`, `31 Dec`) from an ISO date or datetime — the
 * day number unpadded, the month the English 3-letter abbreviation. Empty or
 * malformed input renders as `''`.
 */
export function formatDayMonth(iso: string): string {
  const part = datePart(iso);
  if (part === '' || !isRealDate(part)) return '';
  const [, month, day] = part.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}

/** The `YYYY-MM-DD` after `part`, via UTC so no timezone drift reaches it. */
function addDay(part: string): string {
  const [year, month, day] = part.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/**
 * Todo due-date read-out. Date-only: `No date` / `Today` / `Tomorrow`, otherwise
 * `dd/mm/yyyy`. Timed: the same relative text or date with a local `HH:mm`
 * suffix (`Today 09:30`). `today` (`YYYY-MM-DD`) is injectable for deterministic
 * tests, mirroring `DueDatePill`'s prop; it defaults to the local calendar day.
 */
export function dueDateLabel(dueDate: string | null, today?: string): string {
  if (dueDate == null || dueDate === '') return 'No date';
  const day = dueDay(dueDate);
  if (day === '') return '';
  const base = dueDay(today ?? todayIso());
  const time = localTimePart(dueDate);
  const suffix = time === '' ? '' : ` ${time}`;
  if (base !== '') {
    if (day === base) return `Today${suffix}`;
    if (day === addDay(base)) return `Tomorrow${suffix}`;
  }
  return `${formatDate(day)}${suffix}`;
}
