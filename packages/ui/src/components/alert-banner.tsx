// shadcn/ui registry copy (`alert`), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
import { cva } from 'class-variance-authority';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../lib/cx';

export type AlertBannerTone = 'warning';

export interface AlertBannerProps extends ComponentPropsWithRef<'div'> {
  tone?: AlertBannerTone;
  actions?: ReactNode;
}

/**
 * Registry `alert` surface, theme-mapped: the border draws `--danger`, the fill is
 * the panel, and every length rides a token, so no new colour enters the palette.
 * The banner is one wrapping row — the message, then its actions beside it.
 */
const alertVariants = cva(
  [
    'flex flex-wrap items-center justify-between',
    'gap-[var(--space-0-5)] mb-[var(--space-0-5)]',
    'px-[var(--space-0-75)] py-[var(--space-0-6)]',
    'border rounded-[var(--radius-md)]',
  ].join(' '),
  {
    variants: {
      tone: {
        warning: 'border-danger bg-panel text-text',
      },
    },
    defaultVariants: { tone: 'warning' },
  },
);

const textStyles = 'm-0 text-[length:var(--space-0-9)]';
const actionStyles = 'flex flex-wrap gap-[var(--space-0-5)]';

export function AlertBanner({
  tone = 'warning',
  actions,
  className,
  children,
  ...rest
}: Readonly<AlertBannerProps>) {
  return (
    <div
      data-slot="alert"
      className={cx(
        'ui-alert-banner',
        `ui-alert-banner--${tone}`,
        alertVariants({ tone }),
        className,
      )}
      {...rest}
    >
      <p data-slot="alert-title" className={cx('ui-alert-banner__text', textStyles)}>
        {children}
      </p>
      {actions != null && (
        <div className={cx('ui-alert-banner__actions', actionStyles)}>
          {actions}
        </div>
      )}
    </div>
  );
}
