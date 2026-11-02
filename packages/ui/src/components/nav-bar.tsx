import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface NavBarProps {
  leading?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

/**
 * §8's `.phead`: the leading slot at the top of the panel, the trailing controls on the far edge.
 * The bar draws no outer margin — the step below it belongs to whatever the screen renders next.
 */
const navBarStyles = 'flex items-start gap-[var(--s2)] pt-[var(--s2)]';

/** §8's `.phead__actions`: the trailing controls sit one `--s1` apart, aligned on one line. */
const actionsStyles = 'flex items-center gap-[var(--s1)] ml-auto';

export function NavBar({ leading, trailing, className }: Readonly<NavBarProps>) {
  return (
    <nav className={cx('ui-nav-bar', navBarStyles, className)}>
      {leading}
      {trailing != null && (
        <div className={cx('ui-nav-bar__actions', actionsStyles)}>{trailing}</div>
      )}
    </nav>
  );
}
