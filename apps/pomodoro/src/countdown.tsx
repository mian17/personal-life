import { StatusText } from '@life/ui';

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

export interface CountdownProps {
  remainingMs: number;
}

/** The digits are read, never announced: the status line beside them carries the live text. */
export function Countdown({ remainingMs }: CountdownProps) {
  return (
    <StatusText size="display" aria-live="off">
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
