/**
 * Pure recurrence helpers (module `todo-due-repeat-notify`, plan T4).
 *
 * Operates on the **local** due value, preserving its shape: `YYYY-MM-DD`
 * yields a date-only candidate, `YYYY-MM-DDTHH:mm` keeps its time. All
 * arithmetic is UTC calendar arithmetic on the parsed parts, so month/year
 * lengths and weekday names do not depend on the host zone. `TodoRepeat`
 * (and its `TODO_REPEATS` list) is owned by `@life/shared`.
 */
import type { TodoRepeat } from '@life/shared';

interface Local {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  hasTime: boolean;
}

function parse(local: string): Local {
  const [date, time] = local.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh = 0, mm = 0] = time ? time.split(':').map(Number) : [];
  return { y, m, d, hh, mm, hasTime: time !== undefined };
}

const pad = (n: number): string => String(n).padStart(2, '0');

function format(p: Local): string {
  const date = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  return p.hasTime ? `${date}T${pad(p.hh)}:${pad(p.mm)}` : date;
}

/** Last calendar day of month `m` (1-12) in year `y`. */
function lastDay(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Weekday (0=Sun … 6=Sat) of a calendar date, computed in UTC. */
function weekday(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * One step of `repeat` on the local value. `monthly` clamps to the target
 * month's last day; `yearly` clamps Feb 29 to Feb 28; `weekdays` skips
 * Sat/Sun; `daily`/`weekly` preserve the time-of-day.
 */
export function nextOccurrence(local: string, repeat: TodoRepeat): string {
  const p = parse(local);

  if (repeat === 'daily') {
    p.d += 1;
    return normalize(p);
  }
  if (repeat === 'weekly') {
    p.d += 7;
    return normalize(p);
  }
  if (repeat === 'weekdays') {
    p.d += 1;
    normalize(p);
    while (weekday(p.y, p.m, p.d) === 0 || weekday(p.y, p.m, p.d) === 6) {
      p.d += 1;
      normalize(p);
    }
    return format(p);
  }
  if (repeat === 'monthly') {
    p.m += 1;
    if (p.m > 12) {
      p.m = 1;
      p.y += 1;
    }
    p.d = Math.min(p.d, lastDay(p.y, p.m));
    return format(p);
  }
  if (repeat === 'yearly') {
    p.y += 1;
    p.d = Math.min(p.d, lastDay(p.y, p.m));
    return format(p);
  }
  return local;
}

/** Roll overflowing day fields into the calendar (and clamp to month end). */
function normalize(p: Local): string {
  const rolled = new Date(Date.UTC(p.y, p.m - 1, p.d));
  p.y = rolled.getUTCFullYear();
  p.m = rolled.getUTCMonth() + 1;
  p.d = rolled.getUTCDate();
  return format(p);
}

/**
 * Advance `local` by `repeat` until the candidate is on or after `nowLocal`
 * (same-shape string compare). Never returns a past occurrence.
 */
export function advanceToOnOrAfter(local: string, repeat: TodoRepeat, nowLocal: string): string {
  let candidate = local;
  while (candidate < nowLocal) candidate = nextOccurrence(candidate, repeat);
  return candidate;
}
