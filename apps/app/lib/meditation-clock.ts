import type { BellSchedule } from './meditation-bells';

/**
 * The `/meditation` screens' clock and copy arithmetic (`SPEC-meditation-app` §5): how long
 * is left, the minutes an early stop records, the one sentence the goal reads as, and the
 * bell schedule a sitting rings.
 *
 * The rounding rule is the service's own (`keptMinutes`), restated here because the stop
 * dialog shows the number it is about to save and the two must not drift.
 */

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const MILLISECONDS_PER_SECOND = 1000;
const MINIMUM_RECORDED_MINUTES = 1;

/** A sitting's clock: when it started, what the wall clock says now, and how long it was planned for. */
export interface RunningClock {
  startedAtMs: number;
  nowMs: number;
  plannedMinutes: number;
}

/** A day's live minutes against the goal it faces. */
export interface GoalProgress {
  liveMinutes: number;
  goalMinutes: number;
}

/** The bell configuration a sitting rings from — the settings row's `bells` field. */
export interface BellChoice {
  enabled: boolean;
  offsetSec: number;
  intervalSec: number;
  repeat: number | null;
}

/** Seconds as `m:ss`, or `h:mm:ss` once the sitting runs past an hour. */
export function formatClock(totalSeconds: number): string {
  const wholeSeconds = Math.max(0, Math.ceil(totalSeconds));
  const hours = Math.floor(wholeSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((wholeSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const rest = wholeSeconds % SECONDS_PER_MINUTE;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

/** A count of minutes with the right noun: `1 minute`, `4 minutes`. */
export function minuteUnit(count: number): string {
  return count === 1 ? 'minute' : 'minutes';
}

/** Seconds left of the planned length, never below zero. */
export function remainingSeconds(clock: RunningClock): number {
  const elapsedSeconds = (clock.nowMs - clock.startedAtMs) / MILLISECONDS_PER_SECOND;
  return Math.max(0, clock.plannedMinutes * SECONDS_PER_MINUTE - elapsedSeconds);
}

/** The minutes an early stop records: elapsed rounded up, never below one, never past planned. */
export function cappedMinutes(elapsedSeconds: number, plannedMinutes: number): number {
  const elapsedMinutes = Math.ceil(elapsedSeconds / SECONDS_PER_MINUTE);
  return Math.min(Math.max(elapsedMinutes, MINIMUM_RECORDED_MINUTES), plannedMinutes);
}

/** Today against the goal: nothing yet, partway with what is left, or met. */
export function goalProgressLine(progress: GoalProgress): string {
  const goal = `${progress.goalMinutes} ${minuteUnit(progress.goalMinutes)}`;
  const met = `${progress.liveMinutes} ${minuteUnit(progress.liveMinutes)} today, against a goal of ${goal}`;
  if (progress.liveMinutes >= progress.goalMinutes) return `Goal met · ${met}`;
  if (progress.liveMinutes === 0) return `Nothing yet today · goal ${goal}`;

  const remaining = progress.goalMinutes - progress.liveMinutes;
  return `${progress.liveMinutes} of ${goal} today · ${remaining} ${minuteUnit(remaining)} to go`;
}

/** The schedule a running sitting rings from, or `null` when the bells are switched off. */
export function bellScheduleFor(bells: BellChoice, plannedMinutes: number): BellSchedule | null {
  if (!bells.enabled) return null;
  return {
    durationSec: plannedMinutes * SECONDS_PER_MINUTE,
    offsetSec: bells.offsetSec,
    intervalSec: bells.intervalSec,
    repeat: bells.repeat,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
