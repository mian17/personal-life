/**
 * The interval bells of a sitting (`SPEC-meditation-app` §5): when they ring, the sheet's
 * own arithmetic, and the thin Web Audio scheduler that rings them.
 *
 * Fire times are absolute (`offset + n × interval`), never accumulated, so the n-th bowl
 * lands where the arithmetic says no matter how late a frame or a timer arrives.
 */
import type { BellChoice } from './meditation-clock';

/** One sitting's bell settings: when the first rings, how often, and how many. */
export interface BellSchedule {
  durationSec: number;
  offsetSec: number;
  intervalSec: number;
  /** `null` rings until the sitting ends; a number caps the count. */
  repeat: number | null;
}

/** The sheet's working copy: the offset in seconds, the interval in whole minutes. */
export interface BellsDraft {
  enabled: boolean;
  offsetSec: number;
  intervalMin: number;
  repeat: number | null;
}

/** The three offset fields' parts, in the units the sheet draws them in. */
export interface OffsetParts {
  hours: number;
  minutes: number;
  seconds: number;
}

const BELL_FREQUENCY_HZ = 528;
const BELL_DURATION_SECONDS = 0.4;

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

/** The three fields' bounds: hours 0–23, minutes and seconds 0–59 (spec C2). */
export const OFFSET_PART_MAX = { hours: 23, minutes: 59, seconds: 59 } as const;

/** The service's own ceiling: 23:59:59, the last second of a day (spec C2). */
export const OFFSET_MAX_SEC =
  OFFSET_PART_MAX.hours * SECONDS_PER_HOUR +
  OFFSET_PART_MAX.minutes * SECONDS_PER_MINUTE +
  OFFSET_PART_MAX.seconds;

/**
 * Every minute stepper in meditation: whole ten-minute steps over 10 minutes to a day. Both the
 * sitting's length and the bell interval step by it, and the service refuses what it would not
 * store — the bell interval as seconds, the sitting length as whole minutes.
 */
export const MEDITATION_MINUTE_STEP = { floor: 10, ceiling: 1440, step: 10 } as const;

/** The fire times of the interval bells, in seconds after the sitting starts. */
export function intervalBellTimes({
  durationSec,
  offsetSec,
  intervalSec,
  repeat,
}: BellSchedule): number[] {
  if (intervalSec <= 0) return [];
  if (offsetSec >= durationSec) return [];

  const ringCount = repeat ?? Infinity;
  const times: number[] = [];

  for (let index = 0; index < ringCount; index += 1) {
    const fireAtSec = offsetSec + index * intervalSec;
    if (fireAtSec >= durationSec) break;
    times.push(fireAtSec);
  }

  return times;
}

/** The sheet's draft, read from the bells the service holds: seconds in, whole minutes out. */
export function draftFrom(bells: BellChoice): BellsDraft {
  return {
    enabled: bells.enabled,
    offsetSec: bells.offsetSec,
    intervalMin: Math.round(bells.intervalSec / SECONDS_PER_MINUTE),
    repeat: bells.repeat,
  };
}

/** The draft as the settings row stores it — the one place whole minutes become seconds. */
export function bellsFrom(draft: BellsDraft): BellChoice {
  return {
    enabled: draft.enabled,
    offsetSec: draft.offsetSec,
    intervalSec: draft.intervalMin * SECONDS_PER_MINUTE,
    repeat: draft.repeat,
  };
}

/** Seconds after the start, split into the three fields the sheet draws. */
export function offsetParts(offsetSec: number): OffsetParts {
  return {
    hours: Math.floor(offsetSec / SECONDS_PER_HOUR),
    minutes: Math.floor((offsetSec % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE),
    seconds: offsetSec % SECONDS_PER_MINUTE,
  };
}

/**
 * The three fields read back as seconds. Each part is clamped to its own bound and the sum to
 * a day, so a typed 90 into the minutes field lands on 23:59:59 rather than rolling the hours.
 */
export function offsetFromParts(parts: OffsetParts): number {
  const hours = clampPart(parts.hours, OFFSET_PART_MAX.hours);
  const minutes = clampPart(parts.minutes, OFFSET_PART_MAX.minutes);
  const seconds = clampPart(parts.seconds, OFFSET_PART_MAX.seconds);
  const offsetSec = hours * SECONDS_PER_HOUR + minutes * SECONDS_PER_MINUTE + seconds;
  return Math.min(offsetSec, OFFSET_MAX_SEC);
}

/** The offset one ± press moves: a whole minute, clamped at zero and at the last second. */
export function stepOffset(offsetSec: number, minutes: number): number {
  const moved = offsetSec + minutes * SECONDS_PER_MINUTE;
  return Math.min(Math.max(moved, 0), OFFSET_MAX_SEC);
}

/** The interval one press moves: whole ten-minute steps, clamped to the service's bounds. */
export function stepInterval(intervalMin: number, steps: number): number {
  const moved = intervalMin + steps * MEDITATION_MINUTE_STEP.step;
  return Math.min(Math.max(moved, MEDITATION_MINUTE_STEP.floor), MEDITATION_MINUTE_STEP.ceiling);
}

/** The offset in words, for the summary: `2 h`, `1 min 30 sec`, `0 min` when it is nothing. */
export function formatOffset(offsetSec: number): string {
  const { hours, minutes, seconds } = offsetParts(offsetSec);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} h`);
  if (minutes > 0) parts.push(`${minutes} min`);
  if (seconds > 0) parts.push(`${seconds} sec`);
  return parts.length > 0 ? parts.join(' ') : '0 min';
}

/** The draft as the schedule one sitting rings from. */
export function scheduleOf(draft: BellsDraft, sessionMinutes: number): BellSchedule {
  return {
    durationSec: sessionMinutes * SECONDS_PER_MINUTE,
    offsetSec: draft.offsetSec,
    intervalSec: draft.intervalMin * SECONDS_PER_MINUTE,
    repeat: draft.repeat,
  };
}

/**
 * The sheet's live summary: what the draft will do in a sitting this long. It is derived from
 * the draft on every press, never from what the service holds, and it says so when the schedule
 * yields nothing inside the sitting's own length.
 */
export function describeSchedule(draft: BellsDraft, sessionMinutes: number): string {
  if (!draft.enabled) return 'No interval bells. Only the ending gong.';

  const repeat = draft.repeat === null ? 'unlimited' : `${draft.repeat}×`;
  const offset = formatOffset(draft.offsetSec);
  const schedule = `Bowl every ${draft.intervalMin} min, starting after ${offset}, ${repeat}`;

  const bowls = intervalBellTimes(scheduleOf(draft, sessionMinutes)).length;
  if (bowls === 0) return `${schedule} — no bowl will sound in a ${sessionMinutes} min session.`;
  return `${schedule}. ${bowls} ${bowls === 1 ? 'bowl' : 'bowls'} this session.`;
}

/**
 * Rings the bells the schedule asks for while the sitting runs. The returned function
 * silences what has not rung yet — the caller stops a sitting that ended early.
 */
export function ringIntervalBells(schedule: BellSchedule): () => void {
  const pendingTimers = intervalBellTimes(schedule).map((fireAtSec) =>
    setTimeout(ringBell, fireAtSec * 1000),
  );

  return () => pendingTimers.forEach(clearTimeout);
}

/** A browser without Web Audio simply has no bell; the sitting never hears about it. */
function ringBell(): void {
  const context = openAudioContext();
  if (context === null) return;

  const oscillator = context.createOscillator();
  oscillator.frequency.value = BELL_FREQUENCY_HZ;
  oscillator.connect(context.destination);
  oscillator.onended = () => void context.close();
  oscillator.start();
  oscillator.stop(context.currentTime + BELL_DURATION_SECONDS);
}

function openAudioContext(): AudioContext | null {
  try {
    return new AudioContext();
  } catch {
    return null;
  }
}

/** One field's part, on whole numbers inside its own bound: a typed 90 is its 59, not a roll-over. */
function clampPart(value: number, max: number): number {
  return Math.min(Math.max(Math.round(value), 0), max);
}
