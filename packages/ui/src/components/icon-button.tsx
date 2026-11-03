// shadcn/ui registry copy (`button`, icon control), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type IconButtonVariant = 'default' | 'ghost';

export interface IconButtonProps extends ComponentPropsWithRef<'button'> {
  label: string;
  variant?: IconButtonVariant;
}

/**
 * The revised `.iconbtn` (REVISED-DESIGN §8): a 48px transparent square carrying an
 * `--ink-2` glyph, washing to `--press` under the finger and never drawing a border.
 *
 * The revision gives the icon button one look, so `default` and `ghost` land on the same
 * classes; the prop stays for the call sites that name it, and each value still stamps
 * its modifier class as the hook those call sites and the e2e suite read.
 */
const iconButtonStyles = cx(
  'inline-flex size-[var(--tap)] items-center justify-center',
  'rounded-[var(--r-md)] border-0 bg-transparent text-ink-2',
  'cursor-pointer outline-none motion-safe:transition-colors active:bg-press',
  'focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)] focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-focus',
  'disabled:cursor-not-allowed disabled:opacity-50',
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
        iconButtonStyles,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
