/**
 * The interval bells of a sitting (`SPEC-meditation-app` §5): when they ring, and the
 * thin Web Audio scheduler that rings them.
 *
 * Fire times are absolute (`offset + n × interval`), never accumulated, so the n-th bowl
 * lands where the arithmetic says no matter how late a frame or a timer arrives.
 */

/** One sitting's bell settings: when the first rings, how often, and how many. */
export interface BellSchedule {
  durationSec: number;
  offsetSec: number;
  intervalSec: number;
  /** `null` rings until the sitting ends; a number caps the count. */
  repeat: number | null;
}

const BELL_FREQUENCY_HZ = 528;
const BELL_DURATION_SECONDS = 0.4;

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
