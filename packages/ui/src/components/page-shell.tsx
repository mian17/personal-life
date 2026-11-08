import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type PageShellProps = ComponentPropsWithRef<'main'>;

/**
 * §5's `.frame` + `.panel`: the column is capped at `--frame-max` and centred, its side and top
 * insets are the panel's `--s4`, and its bottom inset clears the home indicator plus the fixed
 * fab — a fab is `--fab-size` tall and floats `--s4` above the home indicator, so the band is
 * the fab's own height plus one full spacing step.
 */
const pageStyles = [
  'max-w-[var(--frame-max)] mx-auto',
  'px-[var(--s4)] pt-[var(--s4)] pb-[calc(var(--fab-size)+var(--s8)+env(safe-area-inset-bottom))]',
].join(' ');

/** The frame every screen renders inside: the column the app's blocks stack down. */
export function PageShell({ className, children, ...rest }: PageShellProps) {
  return (
    <main className={cx('ui-page', pageStyles, className)} {...rest}>
      {children}
    </main>
  );
}
