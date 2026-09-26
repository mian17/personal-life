import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface NavBarProps {
  leading?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

export function NavBar({ leading, trailing, className }: NavBarProps) {
  return (
    <nav className={cx('ui-nav-bar', className)}>
      {leading}
      {trailing != null && <div className="ui-nav-bar__actions">{trailing}</div>}
    </nav>
  );
}
