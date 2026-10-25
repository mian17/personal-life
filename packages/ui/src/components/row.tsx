import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';
import type { StackGap } from './stack';

export interface RowProps extends ComponentPropsWithRef<'div'> {
  gap?: StackGap;
}

/**
 * A horizontal composition row: `display: flex; flex-wrap: wrap` with the same
 * token gap scale as `Stack`. The companion to `Stack` for one-line groupings a
 * caller composes (e.g. a date field with its clear control) where the children
 * must not be split by the parent's rhythm. No outer margins; purely presentational.
 */
export function Row({ gap = 'md', className, children, ...rest }: Readonly<RowProps>) {
  return (
    <div className={cx('ui-row', `ui-row--${gap}`, className)} {...rest}>
      {children}
    </div>
  );
}
