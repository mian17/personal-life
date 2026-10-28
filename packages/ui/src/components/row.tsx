// Composed from utilities (plan Decision 4): shadcn ships no row item, so this
// atom keeps its markup and takes the same token gap scale as `Stack`.
import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';
import type { StackGap } from './stack';

export interface RowProps extends ComponentPropsWithRef<'div'> {
  gap?: StackGap;
}

/** A wrapping flex row: children share one line until they run out of width. */
const rowStyles = 'flex flex-wrap';

const gapStyles: Record<StackGap, string> = {
  sm: 'gap-[var(--space-0-5)]',
  md: 'gap-[var(--space-1)]',
  lg: 'gap-[var(--space-2)]',
};

/**
 * The horizontal companion to `Stack`, for one-line groupings a caller composes
 * (a date field with its clear control) where the parent's rhythm must not split
 * the children. No outer margins; purely presentational.
 */
export function Row({ gap = 'md', className, children, ...rest }: Readonly<RowProps>) {
  return (
    <div
      className={cx('ui-row', `ui-row--${gap}`, rowStyles, gapStyles[gap], className)}
      {...rest}
    >
      {children}
    </div>
  );
}
