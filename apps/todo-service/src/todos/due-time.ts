/**
 * Pure local ⇄ UTC due helpers (module `todo-due-repeat-notify`, plan T4).
 *
 * Built only on `Intl` — no date library. The zone string is resolved once by
 * the caller (`TodosService.tz`) and passed to every function here: one owner
 * for the zone lookup (lesson 0016). `YYYY-MM-DD` stays a calendar date and is
 * never converted; only `YYYY-MM-DDTHH:mm` carries an instant.
 */

/** A due is exactly `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`. */
export const ISO_DUE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

interface Parts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
}

/** Calendar parts of `instant` in `tz` (the inverse of `utcToLocal`). */
function utcParts(instant: Date, tz: string): Parts & { ss: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const p = fmt.formatToParts(instant);
  const get = (type: string): number => Number(p.find((x) => x.type === type)!.value);
  return { y: get('year'), m: get('month'), d: get('day'), hh: get('hour'), mm: get('minute'), ss: get('second') };
}

/** `local` split into calendar parts; a date-only value has `hh`/`mm` = 0. */
function parseLocal(local: string): Parts & { hasTime: boolean } {
  const [date, time] = local.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh = 0, mm = 0] = time ? time.split(':').map(Number) : [];
  return { y, m, d, hh, mm, hasTime: time !== undefined };
}

const pad = (n: number): string => String(n).padStart(2, '0');

function formatLocal(p: Parts, hasTime: boolean): string {
  const date = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  return hasTime ? `${date}T${pad(p.hh)}:${pad(p.mm)}` : date;
}

/**
 * Wall-clock offset of `tz` at `instant`, in ms: the local time read as UTC
 * minus the instant. `Intl` supplies the parts; `Date.UTC` supplies the epoch.
 */
export function zoneOffsetMs(instant: Date, tz: string): number {
  const p = utcParts(instant, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - instant.getTime();
}

/**
 * The UTC instant of a local `YYYY-MM-DDTHH:mm` in `tz`. Two-pass offset
 * resolve: guess with the offset at the naive instant, then re-read the offset
 * at the guess so a DST change between them is picked up.
 */
export function localToUtc(local: string, tz: string): Date {
  const p = parseLocal(local);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
  const firstGuess = new Date(asUtc - zoneOffsetMs(new Date(asUtc), tz));
  return new Date(asUtc - zoneOffsetMs(firstGuess, tz));
}

/** Calendar parts of `instant` in `tz`. */
export function utcToLocal(
  instant: Date,
  tz: string,
): { y: number; m: number; d: number; hh: number; mm: number } {
  const p = utcParts(instant, tz);
  return { y: p.y, m: p.m, d: p.d, hh: p.hh, mm: p.mm };
}

/**
 * Lexicographically sortable due key. Undated (`null`) → `'~'` (sorts last);
 * a date-only value is returned unchanged; a timed value is its **local**
 * `YYYY-MM-DDTHH:mm`.
 */
export function dueSortKey(value: string | null, tz: string): string {
  if (value === null) return '~';
  if (!value.includes('T')) return value;
  return formatLocal(utcToLocal(new Date(value), tz), true);
}

/** Local due that a reminder fires at: date-only → 09:00; timed → itself. */
export function reminderLocal(due: string): string {
  return due.includes('T') ? due : `${due}T09:00`;
}
