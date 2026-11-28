'use client';

import { cx } from '../lib/cx';
import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent, PointerEvent, ReactNode } from 'react';

export type StepperTone = 'card' | 'row' | 'bare';

/** What sits between the pair: a value with its unit, or the control the pair adjusts. */
export type StepperReadout =
  { kind: 'text'; value: string; unit?: string } | { kind: 'control'; children: ReactNode };

export interface StepperProps {
  /** The surface the pair rides on: the idle card, the sheet's sunken bar, or nothing at all. */
  tone?: StepperTone;
  /** A text read-out's tier. Ignored by a `control` read-out, which brings its own type. */
  size?: 'display' | 'row';
  readout: StepperReadout;
  /** The − button's accessible name. The glyph is never the name. */
  decreaseLabel: string;
  /** The + button's accessible name. */
  increaseLabel: string;
  onDecrease: () => void;
  onIncrease: () => void;
  /** At the end of the range the button is inert, so it is also disabled. */
  decreaseDisabled?: boolean;
  increaseDisabled?: boolean;
}

/**
 * How long a press must be held before it repeats: the ~450 ms the platforms give a long press, so a
 * deliberate hold starts repeating without a tap that lingered a moment running away from you.
 */
const STEPPER_REPEAT_DELAY_MS = 450;

/** The repeat rate once it starts: 80 ms is fast enough to cross a range, slow enough to stop on. */
const STEPPER_REPEAT_INTERVAL_MS = 80;

/** The handlers a ± button needs to step on press, keep stepping while held, and stop on release. */
interface PressHandlers {
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
  onBlur: () => void;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

/**
 * Steps on press and repeats while the pointer stays down. A press counts on `pointerdown` alone: the
 * click a pointer press emits carries a non-zero `detail`, so it is dropped, while the zero-detail
 * click a keyboard or assistive activation emits still steps — once, since a held key already
 * repeats on its own and a timer of ours would multiply it.
 */
function useRepeatingPress(onStep: () => void, disabled: boolean): PressHandlers {
  const holding = useRef(false);
  const latestOnStep = useRef(onStep);
  const repeatDelay = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const repeatInterval = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // A repeat outlives the render it began in, and a caller may read its own value from that render,
  // so every tick goes through the handler of the latest one.
  useEffect(() => {
    latestOnStep.current = onStep;
  });

  const stop = useCallback(() => {
    holding.current = false;
    clearTimeout(repeatDelay.current);
    clearInterval(repeatInterval.current);
    repeatDelay.current = undefined;
    repeatInterval.current = undefined;
  }, []);

  const step = useCallback(() => {
    if (!disabled) latestOnStep.current();
  }, [disabled]);

  const start = useCallback(() => {
    if (disabled || holding.current) return;
    holding.current = true;
    step();
    repeatDelay.current = setTimeout(() => {
      repeatInterval.current = setInterval(step, STEPPER_REPEAT_INTERVAL_MS);
    }, STEPPER_REPEAT_DELAY_MS);
  }, [disabled, step]);

  useEffect(() => stop, [stop]);

  useEffect(() => {
    if (disabled) stop();
  }, [disabled, stop]);

  return {
    onPointerDown: (event) => {
      if (event.button > 0) return;
      start();
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onPointerLeave: stop,
    onBlur: stop,
    onClick: (event) => {
      if (event.detail > 0) return;
      step();
    },
  };
}

/** The one row all three tones draw; a tone adds the fill, the radius and its own gaps. */
const pairStyles = 'flex items-center justify-between';

const toneStyles: Record<StepperTone, string> = {
  card: cx(pairStyles, 'gap-[var(--s4)] bg-surface p-[var(--s6)_var(--s5)] rounded-[var(--r-lg)]'),
  row: cx(
    pairStyles,
    'gap-[var(--s3)] bg-surface-sunken min-h-[var(--row-min-height)] px-[var(--s2)] rounded-[var(--r-md)]',
  ),
  bare: cx(pairStyles, 'gap-[var(--s2)]'),
};

/**
 * The ± disc: the `--tap` square the icon controls already draw, filled to read as a disc rather
 * than a square. The press is a colour change and never a transform — `base.css` zeroes
 * durations under `prefers-reduced-motion`, so a scale would snap frame to frame.
 */
const discStyles = cx(
  'inline-flex size-[var(--tap)] flex-none items-center justify-center',
  'rounded-[var(--r-pill)] bg-surface-sunken text-ink',
  'text-[length:var(--fs-sheet-title)] leading-[var(--lh-control)]',
  'cursor-pointer outline-none motion-safe:transition-colors active:bg-press',
  'focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)] focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-focus',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

/** The display tier: a stacked read-out, the figure over its unit. */
const displayReadoutStyles = 'flex min-w-0 flex-col items-center gap-[var(--s1)]';

/** The figure: the timer's size, weight, leading and tracking, untouched by the page's body tier. */
const displayValueStyles =
  'text-[length:var(--fs-timer)] [font-weight:var(--fw-semibold)] leading-[var(--lh-kpi)] tracking-[var(--tracking-timer)]';

/** The unit under a figure, on the section-label tracking and uppercased, as `.duration__unit` is. */
const displayUnitStyles =
  'text-ink-2 text-[length:var(--fs-label)] leading-[var(--lh-meta)] tracking-[var(--tracking-section-label)] uppercase';

/** The row tier: one line at the row-title size, inheriting the body leading. */
const rowReadoutStyles = 'text-[length:var(--fs-row-title)]';

const readoutStyles: Record<NonNullable<StepperProps['size']>, string> = {
  display: displayReadoutStyles,
  row: rowReadoutStyles,
};

/**
 * A `control` read-out is a direct flex child, never a wrapper around one: `NumberField`'s trio is
 * `flex: 1` in the design, and a box of our own would eat the row it is meant to share. The
 * shrink allowance is handed to those children instead of being drawn by a parent.
 */
const controlReadoutStyles = '[&>*]:min-w-0';

/**
 * A ± pair around a read-out. Two native buttons, each named by its own label — the glyphs are
 * `aria-hidden` because the label already names the action — and no `role="group"`, since a
 * labelled pair already says what it moves.
 *
 * A text read-out is an `<output>`: the element for a calculated result, and one that carries a
 * polite live region for free. The ± labels name the control, so without it a screen reader would
 * hear the press and nothing about the number it produced.
 */
export function Stepper({
  tone = 'bare',
  size = 'row',
  readout,
  decreaseLabel,
  increaseLabel,
  onDecrease,
  onIncrease,
  decreaseDisabled = false,
  increaseDisabled = false,
}: Readonly<StepperProps>) {
  const decreasePress = useRepeatingPress(onDecrease, decreaseDisabled);
  const increasePress = useRepeatingPress(onIncrease, increaseDisabled);

  return (
    <div
      className={cx(
        'ui-stepper',
        `ui-stepper--${tone}`,
        toneStyles[tone],
        readout.kind === 'control' && controlReadoutStyles,
      )}
    >
      <button
        type="button"
        aria-label={decreaseLabel}
        className={cx('ui-stepper__button', 'ui-stepper__button--decrease', discStyles)}
        disabled={decreaseDisabled}
        {...decreasePress}
      >
        <span aria-hidden>−</span>
      </button>
      {readout.kind === 'text' ? (
        <output className={cx('ui-stepper__readout', readoutStyles[size])}>
          <span className={cx('ui-stepper__value', size === 'display' && displayValueStyles)}>
            {readout.value}
          </span>
          {readout.unit != null && (
            <span className={cx('ui-stepper__unit', size === 'display' && displayUnitStyles)}>
              {readout.unit}
            </span>
          )}
        </output>
      ) : (
        readout.children
      )}
      <button
        type="button"
        aria-label={increaseLabel}
        className={cx('ui-stepper__button', 'ui-stepper__button--increase', discStyles)}
        disabled={increaseDisabled}
        {...increasePress}
      >
        <span aria-hidden>+</span>
      </button>
    </div>
  );
}
