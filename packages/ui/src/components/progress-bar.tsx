import { cx } from '../lib/cx';

export interface ProgressBarProps {
  /** Percent filled, 0–100; an out-of-range value is clamped, not rejected. */
  value: number;
  /** Accessible name for the bar, e.g. `"Today: 20 of 30 minutes"`. */
  label: string;
  className?: string;
}

const MIN_PERCENT = 0;
const MAX_PERCENT = 100;

/** The trough is the pressed wash, the fill the app accent, both on the pill radius (§6). */
const trackStyles =
  'ui-progress-track block h-[var(--s2)] w-full appearance-none overflow-hidden rounded-[var(--r-pill)] bg-press [&::-moz-progress-bar]:rounded-[var(--r-pill)] [&::-moz-progress-bar]:bg-max [&::-webkit-progress-bar]:bg-transparent [&::-webkit-progress-value]:rounded-[var(--r-pill)] [&::-webkit-progress-value]:bg-max';

/**
 * Today's fill as a native `<progress>`: the element already carries the progressbar
 * role and its own value/max pair, so a one-value bar needs no ARIA scaffold and no
 * chart library. The track-and-fill look comes from token-styled pseudo-elements.
 */
export function ProgressBar({ value, label, className }: Readonly<ProgressBarProps>) {
  const percent = clampedPercent(value);

  return (
    <progress
      aria-label={label}
      aria-valuenow={Math.round(percent)}
      className={cx(trackStyles, className)}
      max={MAX_PERCENT}
      value={percent}
    />
  );
}

/** Keeps a caller's percent inside the range the bar can draw. */
function clampedPercent(value: number): number {
  return Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, value));
}
