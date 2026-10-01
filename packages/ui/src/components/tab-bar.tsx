// React 19 types dropped the global `JSX` namespace; it is exported by `react`.
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface TabProps {
  /** Destination route, app-supplied (e.g. a list route or one of its views). */
  href: string;
  /** Marks the current tab: renders `aria-current="page"`. */
  active?: boolean;
  /** Tab label (frozen visible text, app-supplied). */
  children: ReactNode;
  /** Class passthrough. */
  className?: string;
}

export interface TabBarProps {
  /** Nav landmark name (`aria-label`); frozen text, app-supplied. */
  'aria-label': string;
  /** The `Tab`s in render order. */
  children: ReactNode;
  /** Class passthrough. */
  className?: string;
}

export function Tab({ href, active = false, children, className }: TabProps): JSX.Element {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cx('ui-tab', active && 'ui-tab--active', className)}
    >
      {children}
    </Link>
  );
}

export function TabBar({
  ['aria-label']: ariaLabel,
  children,
  className,
}: TabBarProps): JSX.Element {
  return (
    <nav aria-label={ariaLabel} className={cx('ui-tab-bar', className)}>
      {children}
    </nav>
  );
}
