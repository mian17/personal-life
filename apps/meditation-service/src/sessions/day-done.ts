/**
 * The day-done read (`SPEC-meditation-app` §1, §5, §8 criterion 2): a day is done when the
 * live minutes sat on it reach the current goal, and that answer is never stored. Every read
 * sums decrypted rows and re-measures them, so raising the goal moves past days with no write
 * and no cache invalidation beyond the ordinary one.
 *
 * "Live" is `deletedAt IS NULL`: a stamped sitting is gone from its day exactly as it is gone
 * from the sitting log.
 *
 * A sitting's day is the client's own local day, carried on the row; this service holds no
 * clock for the sitter and derives none (assumption 3).
 */

/** Milliseconds in one day, the step the window walks in. */
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

/**
 * The widest window one read may ask for: a year plus its leap day. A window is a client
 * convenience (a month grid, a year view), never an unbounded scan — every day in it costs
 * a pass over the owner's rows, so the cap is what keeps one request from pinning the
 * event loop for the whole single-user deployment.
 */
export const MAX_WINDOW_DAYS = 366;

/** Whether a day reached the goal. `>=`, so sitting exactly the goal counts as reaching it. */
export function goalReached(minutesSat: number, goalMinutes: number): boolean {
  return minutesSat >= goalMinutes;
}

/** The day window a day-done read covers; both ends are the client's local days. */
export interface DayWindow {
  /** `YYYY-MM-DD`, the first day of the window. */
  from: string;
  /** `YYYY-MM-DD`, the last day of the window. */
  to: string;
}

/** A sitting's contribution to its day, taken from its decrypted envelope. */
export interface SittingMinutes {
  /** The client's own local day the sitting ended in. */
  day: string;
  minutes: number;
  /** A stamped sitting never counts toward its day. */
  deletedAt: string | null;
}

/** One day of the window, as the route serves it. */
export interface DayDone {
  date: string;
  liveMinutes: number;
  goalMinutes: number;
  done: boolean;
}

/** What a whole window is measured against: its days, the rows, and the goal they face. */
export interface DayDoneRequest {
  days: string[];
  sittings: SittingMinutes[];
  goalMinutes: number;
}

/** Every day of the window, each measured against the goal as it stands at this read. */
export function dayDoneWindow(request: DayDoneRequest): DayDone[] {
  return request.days.map((date) => dayDone(date, request));
}

/**
 * How many calendar days a window spans, both ends included — measured before the walk, so
 * an absurd window is refused instead of enumerated. A reversed window counts as zero.
 */
export function windowDayCount({ from, to }: DayWindow): number {
  const span = Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`);
  if (!Number.isFinite(span) || span < 0) return 0;
  return span / DAY_MILLISECONDS + 1;
}

/**
 * The calendar day a sitting ended on, in the clock the sitting carries: the date part of
 * its own `endedAt`. A client's local day is never derived here from a server clock.
 */
export function endedOnDay(endedAt: string): string {
  return endedAt.slice(0, 10);
}

/**
 * Whether `day` can be the client's local day of a sitting that ended at `endedAt`.
 *
 * A UTC timestamp sits at most one calendar day away from the local day it was written on
 * (offsets run -12:00..+14:00), so that is the whole allowance: a report naming any other
 * day is not that sitting's day, and filing it would put the sitting on a day it never ran.
 */
export function canBeFiledOn(day: string, endedAt: string): boolean {
  const daySkew = Math.abs(Date.parse(day) - Date.parse(endedOnDay(endedAt)));
  return Number.isFinite(daySkew) && daySkew <= DAY_MILLISECONDS;
}

/**
 * Every calendar day from `from` to `to` inclusive, as `YYYY-MM-DD`. Both ends are read at
 * midnight UTC so no local clock can shorten or lengthen a day, and a reversed window holds
 * no days at all.
 */
export function daysBetween({ from, to }: DayWindow): string[] {
  const firstMidnight = Date.parse(`${from}T00:00:00.000Z`);
  const lastMidnight = Date.parse(`${to}T00:00:00.000Z`);
  const days: string[] = [];
  for (let midnight = firstMidnight; midnight <= lastMidnight; midnight += DAY_MILLISECONDS) {
    days.push(new Date(midnight).toISOString().slice(0, 10));
  }
  return days;
}

/** Minutes sat on `date`: the live sittings of that day, summed. */
export function liveMinutesOn(date: string, sittings: SittingMinutes[]): number {
  const liveOnDate = sittings.filter((sitting) => countsToward(sitting, date));
  return liveOnDate.reduce((total, sitting) => total + sitting.minutes, 0);
}

function dayDone(date: string, request: DayDoneRequest): DayDone {
  const liveMinutes = liveMinutesOn(date, request.sittings);
  return {
    date,
    liveMinutes,
    goalMinutes: request.goalMinutes,
    done: goalReached(liveMinutes, request.goalMinutes),
  };
}

function countsToward(sitting: SittingMinutes, date: string): boolean {
  return sitting.deletedAt === null && sitting.day === date;
}
