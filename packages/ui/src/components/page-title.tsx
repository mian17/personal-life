import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

/**
 * No registry primitive owns a page heading, so the whole `<h1>` DOM surface — `ref`,
 * `aria-*`, `data-*`, `id` — stays the caller's and passes straight through.
 */
export type PageTitleProps = ComponentPropsWithRef<'h1'>;

/** The page's single heading: display size off the frozen type scale, set tight, clear of the content below. */
const headingStyles =
  'm-[0_0_var(--space-1)] text-[length:var(--space-2)] font-bold tracking-[-0.02em]';

export function PageTitle({ className, children, ...rest }: PageTitleProps) {
  return (
    <h1 className={cx('ui-page-title', headingStyles, className)} {...rest}>
      {children}
    </h1>
  );
}
