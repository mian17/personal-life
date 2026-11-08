import { formatDayMonth } from '@life/ui';
import type { GoalRow, SessionRow } from './focus-api';

/**
 * The stats surface's number arithmetic (`SPEC-pomodoro-stats` §5): rolling
 * windows ending today (map §0.12), the buckets the trend chart draws, and the
 * locked day→goal rule applied over the goal rows the app fetched, so the app
 * never imports from the service workspace.
 *
 * Every date here is computed from its `YYYY-MM-DD` parts, never through a
 * `Date` round trip: a local-calendar bug in bucketing would land a session's
 * minutes on the wrong bar, and no test would see the timezone that caused it.
 */

export type Period = 'week' | 'month' | 'year';

/** One chart bar: a day of a week/month window, or a month of a year window. */
export interface Bucket {
  label: string;
  value: number;
  target?: number;
}

/** The inclusive day range to fetch, and the days the caller pairs rows against. */
export interface StatsWindow {
  from: string;
  to: string;
  days: string[];
}

const DAYS_PER_PERIOD = { week: 7, month: 30 } as const;
const MONTHS_PER_YEAR = 12;

/**
 * The bars for one window: 7 daily, 30 daily, or 12 monthly. Buckets are built
 * from the dates the rows carry, so the caller supplies one row per day of
 * `windowFor(...).days` (zero minutes for a session-less day) and gets one bar
 * per bucket back — a window of all-zero days still draws its full strip.
 *
 * A daily bar's `target` is that day's resolved goal; a monthly bar's is the sum
 * of its days' resolved goals, left `undefined` when no goal row applies rather
 * than invented as a default.
 */
export function bucketsFor(period: Period, rows: SessionRow[], goals: GoalRow[]): Bucket[] {
  return period === 'year' ? monthlyBuckets(rows, goals) : dailyBuckets(rows, goals);
}

/**
 * The day range a period draws, `offset` periods back from `today` (`0` is the
 * window ending today). Week and month windows are fixed day counts; a year
 * window is whole months, so a shifted year window ends on the last day of its
 * final month instead of mid-month.
 */
export function windowFor(period: Period, offset: number, today: string): StatsWindow {
  const end = windowEnd(period, offset, today);
  const days = daysFrom(windowStart(period, end), end);
  return { from: days[0], to: days.at(-1)!, days };
}

/**
 * The locked day→goal rule (`SPEC-focus-service` §1): a day resolves to the
 * minutes of the newest row that took effect on or before it, and to `null`
 * before every row. `YYYY-MM-DD` compares lexically, which is calendar order.
 */
export function resolveGoal(goals: GoalRow[], day: string): number | null {
  let applicable: GoalRow | null = null;
  for (const goal of goals) {
    if (goal.validFrom > day) continue;
    if (applicable === null || goal.validFrom >= applicable.validFrom) applicable = goal;
  }
  return applicable === null ? null : applicable.minutes;
}

function windowEnd(period: Period, offset: number, today: string): string {
  if (period !== 'year') return shiftDay(today, -DAYS_PER_PERIOD[period] * offset);
  if (offset === 0) return today;
  return lastDayOfMonth(shiftMonth(today, -MONTHS_PER_YEAR * offset));
}

function windowStart(period: Period, end: string): string {
  if (period === 'year') return firstDayOfMonth(shiftMonth(end, -(MONTHS_PER_YEAR - 1)));
  return shiftDay(end, -(DAYS_PER_PERIOD[period] - 1));
}

function dailyBuckets(rows: SessionRow[], goals: GoalRow[]): Bucket[] {
  return sortedGroups(groupRowsBy(rows, (row) => row.date)).map(([day, dayRows]) => {
    const target = resolveGoal(goals, day);
    const bucket: Bucket = { label: formatDayMonth(day), value: totalMinutes(dayRows) };
    return target === null ? bucket : { ...bucket, target };
  });
}

function monthlyBuckets(rows: SessionRow[], goals: GoalRow[]): Bucket[] {
  return sortedGroups(groupRowsBy(rows, (row) => row.date.slice(0, 7))).map(([month, monthRows]) => {
    const days = [...new Set(monthRows.map((row) => row.date))];
    const target = monthTarget(days, goals);
    const bucket: Bucket = { label: monthLabel(month), value: totalMinutes(monthRows) };
    return target === undefined ? bucket : { ...bucket, target };
  });
}

/** A month's goal is its days' goals summed, one per day even with several sessions. */
function monthTarget(days: string[], goals: GoalRow[]): number | undefined {
  const dailyGoals = days
    .map((day) => resolveGoal(goals, day))
    .filter((minutes) => minutes !== null);
  if (dailyGoals.length === 0) return undefined;
  return dailyGoals.reduce((total, minutes) => total + minutes, 0);
}

function groupRowsBy(
  rows: SessionRow[],
  keyOf: (row: SessionRow) => string,
): Map<string, SessionRow[]> {
  const groups = new Map<string, SessionRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

function sortedGroups(groups: Map<string, SessionRow[]>): [string, SessionRow[]][] {
  return [...groups].sort(([left], [right]) => left.localeCompare(right));
}

function totalMinutes(rows: SessionRow[]): number {
  return rows.reduce((total, row) => total + row.minutes, 0);
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return `${MONTH_NAMES[monthNumber - 1]} ${year}`;
}

/** Every day from `start` to `end` inclusive, stepped one day at a time. */
function daysFrom(start: string, end: string): string[] {
  const days = [start];
  let day = start;
  while (day !== end) {
    day = neighbouringDay(day, 1);
    days.push(day);
  }
  return days;
}

function shiftDay(day: string, dayCount: number): string {
  const step = dayCount < 0 ? -1 : 1;
  let shifted = day;
  for (let remaining = Math.abs(dayCount); remaining > 0; remaining -= 1) {
    shifted = neighbouringDay(shifted, step);
  }
  return shifted;
}

function shiftMonth(day: string, monthCount: number): string {
  const { year, month, date } = readDay(day);
  const monthIndex = year * MONTHS_PER_YEAR + (month - 1) + monthCount;
  const shiftedYear = Math.floor(monthIndex / MONTHS_PER_YEAR);
  const shiftedMonth = monthIndex - shiftedYear * MONTHS_PER_YEAR + 1;
  const shiftedDate = Math.min(date, daysInMonth(shiftedYear, shiftedMonth));
  return writeDay({ year: shiftedYear, month: shiftedMonth, date: shiftedDate });
}

function neighbouringDay(day: string, step: 1 | -1): string {
  const parts = readDay(day);
  parts.date += step;

  if (parts.date < 1) {
    parts.month -= 1;
    if (parts.month < 1) {
      parts.month = MONTHS_PER_YEAR;
      parts.year -= 1;
    }
    parts.date = daysInMonth(parts.year, parts.month);
  } else if (parts.date > daysInMonth(parts.year, parts.month)) {
    parts.date = 1;
    parts.month += 1;
    if (parts.month > MONTHS_PER_YEAR) {
      parts.month = 1;
      parts.year += 1;
    }
  }

  return writeDay(parts);
}

function firstDayOfMonth(day: string): string {
  const { year, month } = readDay(day);
  return writeDay({ year, month, date: 1 });
}

function lastDayOfMonth(day: string): string {
  const { year, month } = readDay(day);
  return writeDay({ year, month, date: daysInMonth(year, month) });
}

interface DayParts {
  year: number;
  month: number;
  date: number;
}

function readDay(day: string): DayParts {
  const [year, month, date] = day.split('-').map(Number);
  return { year, month, date };
}

function writeDay({ year, month, date }: DayParts): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1];
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
