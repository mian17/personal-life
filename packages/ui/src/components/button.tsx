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
 * Registry variants, theme-mapped: a colour name equals its token name without `--`.
 * Geometry rides the utility scale, so the 48px tap target is `h-12`/`size-12`.
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold cursor-pointer outline-none transition-colors focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)] focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-on-accent',
        ghost: 'border border-border bg-transparent text-text',
        danger: 'bg-transparent text-danger',
        quiet: 'bg-transparent text-accent',
      },
      size: {
        default: 'h-12 px-5 py-3',
        bare: 'h-auto px-3.5 py-1.5 text-sm',
        icon: 'size-12 p-0',
      },
    },
    compoundVariants: [
      // Icon-only danger: no surface of its own, so the panel behind it shows through; the
      // glyph keeps the variant colour and the `icon` size's 48px square.
      {
        variant: 'danger',
        size: 'icon',
        class: 'text-xl leading-none',
      },
      { variant: 'danger', size: 'default', class: 'w-12' },
      { variant: 'danger', size: 'bare', class: 'border border-danger text-sm' },
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
