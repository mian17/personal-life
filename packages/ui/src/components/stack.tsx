// Composed from utilities (plan Decision 4): shadcn ships no stack item, so this
// atom keeps its markup and takes its rhythm from the token gap scale.
import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type StackGap = 'sm' | 'md' | 'lg';

export type StackAlign = 'start' | 'center' | 'end';

export interface StackProps extends ComponentPropsWithRef<'div'> {
  gap?: StackGap;
  align?: StackAlign;
  as?: 'div';
}

/**
 * Grid so children stack whatever their own `display`. Only `gap` drives the
 * rhythm and no outer margin is drawn — spacing above a stack is its parent's job.
 */
const stackStyles = 'grid';

/** The spacing steps: one per gap, `md` matching the base line height. */
const gapStyles: Record<StackGap, string> = {
  sm: 'gap-[var(--s1)]',
  md: 'gap-[var(--s2)]',
  lg: 'gap-[var(--s4)]',
};

/**
 * Alignment across the row axis, for block content narrower than the column
 * (a centred timer card). `start` is the grid's own behaviour, so it adds nothing.
 */
const alignStyles: Record<StackAlign, string | undefined> = {
  start: undefined,
  center: 'justify-items-center',
  end: 'justify-items-end',
};

export function Stack({
  gap = 'md',
  align = 'start',
  as = 'div',
  className,
  children,
  ...rest
}: Readonly<StackProps>) {
  const Tag = as;
  return (
    <Tag
      className={cx(
        'ui-stack',
        `ui-stack--${gap}`,
        alignHook(align),
        stackStyles,
        gapStyles[gap],
        alignStyles[align],
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * Only a non-default alignment names a class: `start` is the grid's own behaviour,
 * so a default Stack renders exactly the classes it always did.
 */
function alignHook(align: StackAlign): string | undefined {
  return align === 'start' ? undefined : `ui-stack--${align}`;
}
