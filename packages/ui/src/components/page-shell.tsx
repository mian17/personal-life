import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type PageShellProps = ComponentPropsWithRef<'main'>;

/**
 * The page column: capped at the content width and centred, with side padding for the
 * screen edges and bottom padding that clears the fixed fab and the home indicator.
 */
const pageStyles = [
  'max-w-[var(--content-width)] mx-auto',
  'px-[var(--space-1)] pt-[var(--space-1)] pb-[calc(var(--space-5)+env(safe-area-inset-bottom))]',
].join(' ');

/** The frame every screen renders inside: the column the app's blocks stack down. */
export function PageShell({ className, children, ...rest }: PageShellProps) {
  return (
    <main className={cx('ui-page', pageStyles, className)} {...rest}>
      {children}
    </main>
  );
}
