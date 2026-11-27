import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface CaptionProps {
  /** `label` is the sheet-label tier — the session line; `meta` is the summary tier. */
  size?: 'label' | 'meta';
  /** Announce the line when it rewrites: the sheet's schedule summary changes on every press. */
  live?: boolean;
  children: ReactNode;
}

/**
 * The session line under a figure: sentence case on the section-label tracking, which is why it
 * cannot share the uppercased unit beside it.
 */
const labelStyles = cx(
  'text-ink-2',
  'text-[length:var(--fs-label)] leading-[var(--lh-meta)] tracking-[var(--tracking-section-label)]',
);

/** The summary tier: one step smaller, no tracking. */
const metaStyles = 'text-ink-2 text-[length:var(--fs-meta)] leading-[var(--lh-meta)]';

const sizeStyles: Record<NonNullable<CaptionProps['size']>, string> = {
  label: labelStyles,
  meta: metaStyles,
};

/**
 * The quiet line under a figure. Plain text by default — a line that never rewrites must not be
 * announced — and `live` adds exactly `aria-live="polite"` for the one line that does, so the
 * schedule a press produced is spoken without claiming a `status` role the caption never fills.
 */
export function Caption({ size = 'label', live = false, children }: Readonly<CaptionProps>) {
  return (
    <p
      aria-live={live ? 'polite' : undefined}
      className={cx('ui-caption', `ui-caption--${size}`, sizeStyles[size])}
    >
      {children}
    </p>
  );
}
