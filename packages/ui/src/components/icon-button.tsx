// shadcn/ui registry copy (`button`, icon control), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
import { cva } from 'class-variance-authority';
import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type IconButtonVariant = 'default' | 'ghost';

export interface IconButtonProps extends ComponentPropsWithRef<'button'> {
  label: string;
  variant?: IconButtonVariant;
}

/** The registry icon size at this control's 40px square: `size-10`. */
const iconButtonVariants = cva(
  'inline-flex size-10 items-center justify-center rounded-md border font-semibold cursor-pointer outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'border-border bg-panel text-text',
        ghost: 'border-transparent bg-transparent text-text',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function IconButton({
  label,
  variant = 'default',
  className,
  children,
  ...rest
}: Readonly<IconButtonProps>) {
  return (
    <button
      type="button"
      aria-label={label}
      data-slot="button"
      className={cx(
        'ui-icon-btn',
        variant !== 'default' && `ui-icon-btn--${variant}`,
        iconButtonVariants({ variant }),
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
