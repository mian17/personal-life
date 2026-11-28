import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface NavBarProps {
  leading?: ReactNode;
  trailing?: ReactNode;
  /**
   * Where the row's slots sit on the cross axis: `start` opens the title on its own top edge, as
   * §8's `.phead` does on every list screen; `center` centres each slot on the row's middle, which
   * is what the design's `.app__header` does when its title is the row's tallest item. Default
   * `'start'`.
   */
  align?: 'start' | 'center';
  className?: string;
}

/**
 * §8's `.phead`: the leading slot at the top of the panel, the trailing controls on the far edge.
 * The bar draws no outer margin — the step below it belongs to whatever the screen renders next.
 */
const navBarStyles = 'flex gap-[var(--s2)] pt-[var(--s2)]';

/**
 * The one class that decides the cross-axis alignment of that row. Two mutually exclusive values
 * rather than an additive override: a row carrying both would be decided by the generated sheet's
 * order, not by the prop.
 */
const rowAlignStyles: Record<NonNullable<NavBarProps['align']>, string> = {
  start: 'items-start',
  center: 'items-center',
};

/** §8's `.phead__actions`: the trailing controls sit one `--s1` apart, aligned on one line. */
const actionsStyles = 'flex items-center gap-[var(--s1)] ml-auto';

export function NavBar({ leading, trailing, align = 'start', className }: Readonly<NavBarProps>) {
  return (
    <nav className={cx('ui-nav-bar', navBarStyles, rowAlignStyles[align], className)}>
      {leading}
      {trailing != null && (
        <div className={cx('ui-nav-bar__actions', actionsStyles)}>{trailing}</div>
      )}
    </nav>
  );
}
