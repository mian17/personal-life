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
 * §8's tone pair on a card surface: the tint behind, the tone word on top, one line of the same
 * tone — a status never paints a saturated block. The banner is one wrapping row — the message,
 * then its actions beside it — and its radius is the card's, not a control's.
 */
const alertVariants = cva(
  [
    'flex flex-wrap items-center justify-between',
    'gap-[var(--s2)] mb-[var(--s3)]',
    'px-[var(--s4)] py-[var(--s3)]',
    'border rounded-[var(--r-lg)]',
  ].join(' '),
  {
    variants: {
      tone: {
        warning: 'border-warn bg-warn-soft text-warn',
      },
    },
    defaultVariants: { tone: 'warning' },
  },
);

const textStyles = 'm-0 text-[length:var(--fs-label)]';
const actionStyles = 'flex flex-wrap gap-[var(--s2)]';

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
