// shadcn/ui registry copy (`input`), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
import { cva } from 'class-variance-authority';
import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type InputVariant = 'default' | 'bare';

export interface InputProps extends ComponentPropsWithRef<'input'> {
  /** `bare` drops the field shell so a composed shell (the search box) can draw it. */
  variant?: InputVariant;
}

/**
 * The revised `.input` (REVISED-DESIGN §8): a 48px field on the strong hairline, 16px field
 * type, the focus ring drawn on the field itself. `[font:inherit]` stands in for the
 * preflight this package deliberately does not load. The field step is `--fs-button` — §8 sets
 * `.input` and `.search input` at 16px, and only `.textarea` runs the 17px `--fs-body`.
 *
 * `bare` is the same control with the shell removed — transparent, borderless, full height —
 * for the shell that owns the border and the focus ring instead.
 */
const inputVariants = cva(
  cx(
    'block w-full min-w-0 [font:inherit] outline-none motion-safe:transition-colors',
    'placeholder:text-ink-3 disabled:cursor-not-allowed disabled:text-ink-3',
  ),
  {
    variants: {
      variant: {
        default: cx(
          'h-[var(--tap)] px-[var(--s4)] rounded-[var(--r-md)] border border-line-strong bg-surface',
          'text-[length:var(--fs-button)] text-ink',
          'file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-[length:var(--fs-label)] file:font-semibold file:text-ink',
          'focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)] focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-focus',
        ),
        bare: 'h-full flex-1 border-0 bg-transparent p-0 text-[length:var(--fs-button)] text-ink',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

/**
 * The control types whose value is drawn by a UA shadow tree — the locale date/time text plus
 * the calendar/clock picker indicator. That content carries its own intrinsic width and stays
 * nowrap, so it never shrinks with the control's box the way a text input's value does: `min-w-0`
 * lets the box shrink and the shadow content then paints past the padding box. These types get
 * the control's own reset — no UA appearance, the shadow parts told to shrink, and an end inset
 * one step tighter so the indicator has room — so the field keeps the sibling width and contains
 * its content. Every other type keeps the shared shell untouched.
 */
const dateTimeTypes = new Set(['date', 'time', 'datetime-local', 'month', 'week']);

/** `!` on the end inset because `cx` joins and never merges: only `!` beats the shell's `px-`.
 *  The start inset stays `--s4`, so the date text keeps the same left edge as its siblings. */
const dateTimeStyles = cx(
  'max-w-full appearance-none overflow-hidden pe-[var(--s2)]!',
  '[&::-webkit-datetime-edit]:min-w-0 [&::-webkit-calendar-picker-indicator]:shrink-0',
);

export function Input({ type, variant = 'default', className, ...rest }: Readonly<InputProps>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cx(
        'ui-input',
        variant !== 'default' && `ui-input--${variant}`,
        inputVariants({ variant }),
        variant === 'default' && dateTimeTypes.has(type ?? '') && dateTimeStyles,
        className,
      )}
      {...rest}
    />
  );
}
