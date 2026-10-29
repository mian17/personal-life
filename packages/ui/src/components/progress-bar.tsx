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

const trackStyles =
  'ui-progress-track h-[var(--space-0-5)] w-full overflow-hidden rounded-[var(--radius-pill)] bg-border';

const fillStyles = 'ui-progress-fill h-full rounded-[var(--radius-pill)] bg-accent';

/**
 * Today's fill as a plain `width:%` div: a one-value bar needs no chart library, so it
 * renders a token-styled track and a fill whose only inline style is its width.
 */
export function ProgressBar({ value, label, className }: Readonly<ProgressBarProps>) {
  const percent = clampedPercent(value);

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={MIN_PERCENT}
      aria-valuemax={MAX_PERCENT}
      aria-valuenow={Math.round(percent)}
      className={cx(trackStyles, className)}
    >
      <div className={fillStyles} style={{ width: `${percent}%` }} />
    </div>
  );
}

/** Keeps a caller's percent inside the range the bar can draw. */
function clampedPercent(value: number): number {
  return Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, value));
}
