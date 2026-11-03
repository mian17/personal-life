// shadcn/ui registry copy (`button`), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
import { cva } from 'class-variance-authority';
import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'quiet';
export type ButtonSize = 'default' | 'bare' | 'icon';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/**
 * The revised `.btn` (REVISED-DESIGN §8): a full-width control on the 48px tap floor,
 * one accent fill and one pressed move. `ghost` is the outlined secondary, `danger` the
 * text-only destructive action, `quiet` the text-only accent action.
 *
 * Every length is a `--token`; the registry's utility scale is gone, so a theme change
 * moves this button without touching this file.
 */
export const buttonVariants = cva(
  cx(
    'inline-flex items-center justify-center gap-[var(--s2)]',
    'rounded-[var(--r-md)] font-semibold whitespace-nowrap',
    'text-[length:var(--fs-button)] tracking-[var(--tracking-button)]',
    'cursor-pointer outline-none motion-safe:transition-colors',
    'focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)] focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-focus',
    'disabled:cursor-not-allowed disabled:opacity-50',
  ),
  {
    variants: {
      variant: {
        primary: 'border border-max bg-max text-on-max active:border-max-press active:bg-max-press',
        ghost: 'border border-line-strong bg-transparent text-ink active:bg-press',
        danger: 'bg-transparent text-danger active:bg-danger-soft',
        quiet: 'bg-transparent text-max active:bg-press',
      },
      size: {
        default: 'w-full min-h-[var(--tap)] px-[var(--s5)]',
        bare: 'w-auto min-h-0 px-[var(--s3)] py-[var(--s2)]',
        icon: 'size-[var(--tap)] p-0',
      },
    },
    compoundVariants: [
      // An icon-sized control draws one glyph, so the line box must not add height.
      { variant: 'danger', size: 'icon', class: 'text-xl leading-none' },
    ],
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export function Button({
  variant = 'primary',
  size = 'default',
  type = 'button',
  className,
  children,
  ...rest
}: Readonly<ButtonProps>) {
  return (
    <button
      type={type}
      data-slot="button"
      className={cx(
        'ui-btn',
        `ui-btn--${variant}`,
        `ui-btn--${size}`,
        buttonVariants({ variant, size }),
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
