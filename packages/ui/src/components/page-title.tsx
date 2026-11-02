import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

/**
 * No registry primitive owns a page heading, so the whole `<h1>` DOM surface — `ref`,
 * `aria-*`, `data-*`, `id` — stays the caller's and passes straight through.
 */
export type PageTitleProps = ComponentPropsWithRef<'h1'>;

/** §8's `.h1`: the display size set tight, clear of the content below. */
const headingStyles = cx(
  'm-[var(--s2)_0_var(--s4)]',
  'text-[length:var(--fs-title)] leading-[var(--lh-title)] font-bold tracking-[var(--tracking-title)]',
);

export function PageTitle({ className, children, ...rest }: PageTitleProps) {
  return (
    <h1 className={cx('ui-page-title', headingStyles, className)} {...rest}>
      {children}
    </h1>
  );
}
