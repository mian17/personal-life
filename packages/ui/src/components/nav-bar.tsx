import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface NavBarProps {
  leading?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

/** The page's top row: the leading slot, then the trailing controls pushed to the far edge. */
const navBarStyles = 'flex items-center gap-[var(--space-0-5)] m-[0_0_var(--space-0-25)]';

/** The trailing group keeps the bar's own rhythm, so its controls line up whatever they are. */
const actionsStyles = 'flex items-center gap-[var(--space-0-5)] ml-auto';

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
