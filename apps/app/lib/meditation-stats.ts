import { formatDayMonth, weekdayShort } from '@life/ui';
import type { GoalRow, SittingRow } from './meditation-api';
import { monthLabel, resolveGoal, windowFor } from './stats-buckets';

/**
 * The stats lens' bucket arithmetic (`SPEC-meditation-app` §1): the week, month and year
 * windows, the bars each one draws, and the totals read beside them.
 *
 * A sitting lands in the bar of the local day it ended on — `SittingRow.day`, written from the
 * same clock that stamps `endedAt`, so a bar is that day's half-open local range without a zone
 * being re-derived here. A stamped sitting is not part of any bar: a delete removes it from
 * every read, and the lens reads the same rows the day-done rule sums.
 *
 * Each bar also carries the goal that applied to it, resolved from the owner's goal history
 * through the same day→goal rule pomodoro's chart uses: the dashed line a past day draws is the
 * goal that applied then, not today's.
 */

export type Lens = 'week' | 'month' | 'year';

/** One bar of the lens: a day of a week or month window, or a month of a year window. */
export interface LensBar {
  label: string;
  value: number;
  /** What the bar aimed for, when a goal applied to it; absent when none did. */
  target?: number;
}

/** What the lens reads out beside its bars, every number measured over the same window. */
export interface LensTotals {
  minutes: number;
  sittings: number;
  averageMinutes: number;
}

/** One lens for one window: the bars to draw and the totals that describe them. */
export interface LensSummary {
  bars: LensBar[];
  totals: LensTotals;
}

/**
 * The window's bars — 7 daily, 30 daily, or 12 monthly, empty ones included — and its totals.
 *
 * `goals` is the owner's whole goal history: a day bar aims for that day's resolved goal, and a
 * month bar for the sum of its days', so the line over a bar is the target that applied to it.
 */
export function lensFor(
  lens: Lens,
  sittings: SittingRow[],
  goals: GoalRow[],
  today: string,
): LensSummary {
  const days = windowFor(lens, 0, today).days;
  const windowDays = new Set(days);
  const inWindow = sittings.filter((sitting) => isLiveOn(sitting, windowDays));
  const minutesPerDay = minutesByDay(inWindow);
  const targetPerDay = targetsByDay(days, goals);

  const bars =
    lens === 'year'
      ? monthBars(days, minutesPerDay, targetPerDay)
      : dayBars(lens, days, minutesPerDay, targetPerDay);
  return { bars, totals: totalsFor(inWindow, bars) };
}

/** Each window day's resolved goal; a day before every goal row has none and is left out. */
function targetsByDay(days: string[], goals: GoalRow[]): Map<string, number> {
  const targets = new Map<string, number>();
  for (const day of days) {
    const target = resolveGoal(goals, day);
    if (target !== null) targets.set(day, target);
  }
  return targets;
}

/** Whether a sitting counts in this window: it ended inside it, and no delete has stamped it. */
function isLiveOn(sitting: SittingRow, windowDays: Set<string>): boolean {
  return sitting.deletedAt === null && windowDays.has(sitting.day);
}

/** The minutes each recorded day holds; several sittings on one day add up to that day's bar. */
function minutesByDay(sittings: SittingRow[]): Map<string, number> {
  const minutes = new Map<string, number>();
  for (const sitting of sittings) {
    minutes.set(sitting.day, (minutes.get(sitting.day) ?? 0) + sitting.minutes);
  }
  return minutes;
}

/** One bar per window day, in calendar order, so a day with no sitting still draws its bar. */
function dayBars(
  lens: Lens,
  days: string[],
  minutesPerDay: Map<string, number>,
  targetPerDay: Map<string, number>,
): LensBar[] {
  return days.map((day) =>
    withTarget(
      { label: dayLabel(lens, day), value: minutesPerDay.get(day) ?? 0 },
      targetPerDay.get(day),
    ),
  );
}

/** A bar aims for its target only when there is one; an untargeted bar carries no `target` key. */
function withTarget(bar: LensBar, target: number | undefined): LensBar {
  return target === undefined ? bar : { ...bar, target };
}

/** A week's bar is named by its weekday; a month's by its day and month, since 30 bars span two. */
function dayLabel(lens: Lens, day: string): string {
  return lens === 'week' ? weekdayShort(day) : formatDayMonth(day);
}

/** One bar per calendar month of the window, in order, so a month with no sitting still draws. */
function monthBars(
  days: string[],
  minutesPerDay: Map<string, number>,
  targetPerDay: Map<string, number>,
): LensBar[] {
  return monthsOf(days).map((month) =>
    withTarget(
      { label: monthLabel(month), value: monthMinutes(month, minutesPerDay) },
      monthTarget(month, targetPerDay),
    ),
  );
}

/** A month aims for its days' goals summed, one per day; a month with no resolved day aims for nothing. */
function monthTarget(month: string, targetPerDay: Map<string, number>): number | undefined {
  let target = 0;
  let resolved = 0;
  for (const [day, dayTarget] of targetPerDay) {
    if (!day.startsWith(month)) continue;
    target += dayTarget;
    resolved += 1;
  }
  return resolved === 0 ? undefined : target;
}

/** The months the window's days fall in, oldest first. */
function monthsOf(days: string[]): string[] {
  return [...new Set(days.map((day) => day.slice(0, 7)))];
}

function monthMinutes(month: string, minutesPerDay: Map<string, number>): number {
  let minutes = 0;
  for (const [day, dayMinutes] of minutesPerDay) {
    if (day.startsWith(month)) minutes += dayMinutes;
  }
  return minutes;
}

/** The window's read-out, summed from the bars it draws, so the total cannot disagree with them. */
function totalsFor(sittings: SittingRow[], bars: LensBar[]): LensTotals {
  const minutes = bars.reduce((total, bar) => total + bar.value, 0);
  return {
    minutes,
    sittings: sittings.length,
    averageMinutes: averageMinutes(minutes, sittings.length),
  };
}

/** Whole minutes per sitting; a window with no sitting averages to zero rather than `NaN`. */
function averageMinutes(minutes: number, sittings: number): number {
  if (sittings === 0) return 0;
  return Math.round(minutes / sittings);
}
