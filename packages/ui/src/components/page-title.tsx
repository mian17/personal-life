import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../lib/cx';

/**
 * No registry primitive owns a page heading, so the whole `<h1>` DOM surface — `ref`,
 * `aria-*`, `data-*`, `id` — stays the caller's and passes straight through.
 */
export interface PageTitleProps extends ComponentPropsWithRef<'h1'> {
  /** §8's `.phead__sub`: one quiet line under the heading. Omitted, the heading renders alone. */
  sub?: ReactNode;
}

/** §8's `.h1`: the display size set tight, clear of the content below. */
const headingStyles = cx(
  'm-[var(--s2)_0_var(--s4)]',
  'text-[length:var(--fs-title)] leading-[var(--lh-title)] font-bold tracking-[var(--tracking-title)]',
);

/** With a sub-line the heading's own bottom step is dropped, so `--s1` is the whole gap. */
const headingWithSubStyles = 'mb-0';

/**
 * §8's `.phead__sub` (the mapping `ListShell` already uses): one step under the meta tier, in the
 * second ink, `--s1` below the heading — and the heading block's usual `--s4` step below itself.
 */
const subStyles = cx(
  'ui-page-title__sub',
  'mt-[var(--s1)] mb-[var(--s4)]',
  'text-[length:var(--fs-meta)] leading-[var(--lh-meta)] text-ink-2',
);

export function PageTitle({ sub, className, children, ...rest }: PageTitleProps) {
  return (
    <>
      <h1
        className={cx('ui-page-title', headingStyles, sub != null && headingWithSubStyles, className)}
        {...rest}
      >
        {children}
      </h1>
      {sub != null && <p className={subStyles}>{sub}</p>}
    </>
  );
}
