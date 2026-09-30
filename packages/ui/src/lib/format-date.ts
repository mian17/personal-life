import { todayIso } from '../components/due-date-pill';

/**
 * Shared date formatting. Every frontend date read-out renders `dd/mm/yyyy`;
 * the calendar parts are read from the ISO string itself, so a negative-offset
 * timezone can never shift the day (`2026-10-01T00:00:00Z` stays 01/10/2026 in
 * UTC-8 instead of becoming 30/09/2026).
 */
const DATE_PART = /^(\d{4})-(\d{2})-(\d{2})/;

/** Leading `YYYY-MM-DD` of an ISO string, or `''` when there is none. */
function datePart(iso: string): string {
  const match = DATE_PART.exec(iso);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

/** True when `YYYY-MM-DD` names a real calendar day (rejects 2026-02-31). */
function isRealDate(part: string): boolean {
  const [year, month, day] = part.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

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

/** The `YYYY-MM-DD` after `part`, via UTC so no timezone drift reaches it. */
function addDay(part: string): string {
  const [year, month, day] = part.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/**
 * Todo due-date read-out: `No date` / `Today` / `Tomorrow`, otherwise
 * `formatDate(dueDate)`. `today` (`YYYY-MM-DD`) is injectable for deterministic
 * tests, mirroring `DueDatePill`'s prop; it defaults to the local calendar day.
 */
export function dueDateLabel(dueDate: string | null, today?: string): string {
  if (dueDate == null || dueDate === '') return 'No date';
  const day = datePart(dueDate);
  const base = datePart(today ?? todayIso());
  if (day !== '' && isRealDate(base)) {
    if (day === base) return 'Today';
    if (day === addDay(base)) return 'Tomorrow';
  }
  return formatDate(dueDate);
}
