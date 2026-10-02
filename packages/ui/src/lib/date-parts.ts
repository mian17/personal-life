/**
 * Low-level date/time parts. The single owner of the local calendar day, the
 * local time part and the local "today", so no component or app re-derives them
 * (Contract 1 Rule 3 / lesson 0016). Calendar parts are read from the ISO
 * string itself where possible, so a negative-offset timezone can never shift a
 * written date.
 */
const DATE_PART = /^(\d{4})-(\d{2})-(\d{2})/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Local calendar date as `YYYY-MM-DD` (the ISO shape the todo API uses). */
export function todayIso(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Leading `YYYY-MM-DD` of an ISO string, or `''` when there is none. */
export function datePart(iso: string): string {
  const match = DATE_PART.exec(iso);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

/** True when `YYYY-MM-DD` names a real calendar day (rejects 2026-02-31). */
export function isRealDate(part: string): boolean {
  const [year, month, day] = part.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * The local calendar day `YYYY-MM-DD` of a due value. A date-only value
 * (`YYYY-MM-DD`, validated as a real day) returns its own parts with no `Date`
 * round-trip; a timed instant returns its local day. Missing or malformed →
 * `''`.
 */
export function dueDay(value: string | null | undefined): string {
  if (value == null || value === '') return '';
  if (DATE_ONLY.test(value)) return isRealDate(value) ? value : '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : todayIso(date);
}

/** Short English weekday names indexed by ISO weekday − 1 (ISO 1 = Monday). */
export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/**
 * ISO weekday `1..7` (ISO 1 = Monday, 7 = Sunday) of an ISO date or datetime,
 * read from the written calendar parts. Empty/malformed → `0`.
 */
export function isoWeekday(iso: string): number {
  const part = datePart(iso);
  if (part === '' || !isRealDate(part)) return 0;
  const [year, month, day] = part.split('-').map(Number);
  const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return utcDay === 0 ? 7 : utcDay;
}

/** Short English weekday (`Thu`) of an ISO date or datetime; `''` when malformed. */
export function weekdayShort(iso: string): string {
  const wd = isoWeekday(iso);
  return wd === 0 ? '' : WEEKDAY_SHORT[wd - 1];
}

/**
 * The local `HH:mm` (zero-padded) of a timed value; `''` for a date-only,
 * missing or malformed value. The single owner of the timed local time part.
 */
export function localTimePart(value: string | null | undefined): string {
  if (value == null || value === '' || DATE_ONLY.test(value)) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
