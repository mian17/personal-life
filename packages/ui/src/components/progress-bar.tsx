import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface ProgressBarProps {
  /** Percent filled, 0–100; an out-of-range value is clamped, not rejected. */
  value: number;
  /** Accessible name for the bar, e.g. `"Today: 20 of 30 minutes"`. */
  label: string;
  /**
   * Visible read-out drawn on the line above the bar (`"Protein · 62 / 120 g"`),
   * so a bar can say what it measures without borrowing a section label. Absent,
   * the atom renders the bare `<progress>` it always did. With `readout` it is the
   * row's left label instead (the reference's `.macro__label`).
   */
  caption?: ReactNode;
  /**
   * Trailing read-out for the row shape (`"62 / 120 g"`): with a `caption` too, the
   * label, the track and this value share one grid row. Only drawn beside a
   * caption — a read-out with no label to sit against is not rendered.
   */
  readout?: ReactNode;
  className?: string;
  /**
   * The trough's wash. `press` is the atom's long-standing pressed token; `line` is the
   * reference's `.track` hairline, drawn on the revised day card. Both are tokens, so the
   * colour never comes from the caller.
   */
  tone?: ProgressBarTone;
  /** The trough's height: `s2` is the atom's, `s1` the design's hairline track. Default `s2`. */
  height?: 's1' | 's2';
}

export type ProgressBarTone = 'press' | 'line';

const MIN_PERCENT = 0;
const MAX_PERCENT = 100;

/** The fill is the app accent on the pill radius; the trough's wash is the caller's `tone` (§6). */
const trackStyles =
  'ui-progress-track block w-full appearance-none overflow-hidden rounded-[var(--r-pill)] [&::-moz-progress-bar]:rounded-[var(--r-pill)] [&::-moz-progress-bar]:bg-max [&::-webkit-progress-bar]:bg-transparent [&::-webkit-progress-value]:rounded-[var(--r-pill)] [&::-webkit-progress-value]:bg-max';

/** One trough height per step: the atom's two-step track, or the design's hairline. */
const heightStyles: Record<NonNullable<ProgressBarProps['height']>, string> = {
  s1: 'h-[var(--s1)]',
  s2: 'h-[var(--s2)]',
};

/** One trough wash per tone; `press` stays the default so existing bars do not move. */
const troughStyles: Record<ProgressBarTone, string> = {
  press: 'bg-press',
  line: 'bg-line',
};

/** §8's `.row__meta` treatment for the caption line. */
const captionStyles = 'text-ink-2 text-[length:var(--fs-meta)] leading-[var(--lh-meta)]';

/** One spacing step between the caption and the bar it names. */
const captionedStyles = 'grid gap-[var(--s1)]';

/**
 * §8's `.macro`: label column, the track, the read-out column, all centred on one
 * row. The reference fixes the two columns at 64px and 88px (`--s4`×4, `--s2`×11)
 * so every macro row's track starts and ends on the same line.
 */
const rowStyles =
  'grid grid-cols-[calc(var(--s4)*4)_1fr_calc(var(--s2)*11)] items-center gap-[var(--s3)]';

/** §8's `.macro__label`: one label step, semibold. */
const rowLabelStyles = 'text-[length:var(--fs-label)] font-semibold';

/** §8's `.macro__value`: same step as the label, second ink tier, right-aligned figures. */
const readoutStyles = 'text-[length:var(--fs-label)] text-ink-2 text-right tabular-nums';

/**
 * Today's fill as a native `<progress>`: the element already carries the progressbar
 * role and its own value/max pair, so a one-value bar needs no ARIA scaffold and no
 * chart library. The track-and-fill look comes from token-styled pseudo-elements.
 *
 * A `caption` adds one line above the bar; the wrapper owns the caller's `className`
 * in that shape, so the bar itself keeps its full width either way. A `caption` plus
 * a `readout` is the reference's macro row — label, track and value on one line.
 */
export function ProgressBar({
  value,
  label,
  caption,
  readout,
  className,
  tone = 'press',
  height = 's2',
}: Readonly<ProgressBarProps>) {
  const percent = clampedPercent(value);
  const bar = (
    <progress
      aria-label={label}
      aria-valuenow={Math.round(percent)}
      className={cx(
        trackStyles,
        heightStyles[height],
        troughStyles[tone],
        caption == null && className,
      )}
      max={MAX_PERCENT}
      value={percent}
    />
  );

  if (caption != null && readout != null) {
    return (
      <div className={cx('ui-progress ui-progress--row', rowStyles, className)}>
        <span className={cx('ui-progress__caption', rowLabelStyles)}>{caption}</span>
        {bar}
        <span className={cx('ui-progress__readout', readoutStyles)}>{readout}</span>
      </div>
    );
  }

  if (caption == null) return bar;

  return (
    <div className={cx('ui-progress', captionedStyles, className)}>
      <span className={cx('ui-progress__caption', captionStyles)}>{caption}</span>
      {bar}
    </div>
  );
}

/** Keeps a caller's percent inside the range the bar can draw. */
function clampedPercent(value: number): number {
  return Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, value));
}
