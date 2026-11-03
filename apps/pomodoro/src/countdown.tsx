import { StatusText } from '@life/ui';

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

export interface CountdownProps {
  remainingMs: number;
}

/**
 * §8's `.timer__time`: the digits' own line box and figure treatment. The size is the
 * `display` tier's; weight, tight tracking and tabular figures are the read-out's.
 */
const timeStyles =
  'tabular-nums leading-[var(--lh-control)] font-semibold tracking-[var(--tracking-timer)]';

/**
 * The digits are read, never announced: the status line beside them carries the live
 * text. `role="timer"` is the reference's own role for the read-out — a timer region
 * is a live region that is polite by default, so the explicit `off` still holds it to
 * "read on arrival, never interrupt".
 */
export function Countdown({ remainingMs }: Readonly<CountdownProps>) {
  return (
    <StatusText size="display" role="timer" aria-live="off" className={timeStyles}>
      {formatCountdown(remainingMs)}
    </StatusText>
  );
}

/** Rounds up so a phase that just started reads its full length, not a second less. */
function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.ceil(remainingMs / MILLISECONDS_PER_SECOND);
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return `${pad(minutes)}:${pad(seconds)}`;
}

function pad(part: number): string {
  return String(part).padStart(2, '0');
}
