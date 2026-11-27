import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface PageTitleProps extends ComponentPropsWithRef<'h1'> {
  /** §8's `.phead__sub`: one quiet line under the heading. Omitted, the heading renders alone. */
  sub?: ReactNode;
  /** `h2` is a title inside a panel — the complete screen's — not the page's own heading. */
  headingLevel?: 'h1' | 'h2';
  /** The title tier's weight: the design's titles are 600, the atom's default is 700. */
  weight?: 'semibold' | 'bold';
}

/** §8's `.h1`: the display size set tight. */
const headingStyles =
  'text-[length:var(--fs-title)] leading-[var(--lh-title)] tracking-[var(--tracking-title)]';

/**
 * The page heading's own block margins, clear of the content below a page title. A title inside a
 * panel drops them: the panel's column gap already spaces it, and the two together would sit it low.
 */
const pageHeadingStyles = 'm-[var(--s2)_0_var(--s4)]';

/** The tier's weight, selected rather than stacked — two weights cannot share one declaration. */
const weightStyles: Record<NonNullable<PageTitleProps['weight']>, string> = {
  semibold: '[font-weight:var(--fw-semibold)]',
  bold: 'font-bold',
};

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

/**
 * The page's own heading — or, at `headingLevel="h2"`, a title inside a panel. The `<h1>` DOM
 * surface (`ref`, `aria-*`, `data-*`, `id`) stays the caller's and passes straight through.
 */
export function PageTitle({
  sub,
  headingLevel = 'h1',
  weight = 'bold',
  className,
  children,
  ...rest
}: Readonly<PageTitleProps>) {
  const Heading = headingLevel;
  const isPageHeading = headingLevel === 'h1';

  return (
    <>
      <Heading
        className={cx(
          'ui-page-title',
          isPageHeading && pageHeadingStyles,
          headingStyles,
          weightStyles[weight],
          isPageHeading && sub != null && headingWithSubStyles,
          className,
        )}
        {...rest}
      >
        {children}
      </Heading>
      {sub != null && <p className={subStyles}>{sub}</p>}
    </>
  );
}
