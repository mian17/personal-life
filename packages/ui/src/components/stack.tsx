// Composed from utilities (plan Decision 4): shadcn ships no stack item, so this
// atom keeps its markup and takes its rhythm from the token gap scale.
import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type StackGap = 'sm' | 'md' | 'lg';

export type StackAlign = 'start' | 'center' | 'end';

export interface StackProps extends ComponentPropsWithRef<'div'> {
  /**
   * The rhythm between children: the three shared steps, plus `xl` — the `--s6` section step both
   * meditation screens sit on. Default `'md'`.
   */
  gap?: StackGap | 'xl';
  /** The grid's inline-axis alignment. A centred screen centres on both axes, so it rarely needs one. */
  align?: StackAlign;
  /**
   * A screen rather than a list: the children centre on both axes inside the height the parent
   * gives them, the text centres with them, and the stack draws the screen's own `--s8` inset.
   * Off by default, so every shipped stack keeps its grid.
   */
  centred?: boolean;
  as?: 'div';
}

/**
 * Grid so children stack whatever their own `display`. Only `gap` drives the
 * rhythm and no outer margin is drawn — spacing above a stack is its parent's job.
 */
const stackStyles = 'grid';

/**
 * A centred screen swaps the grid for a column. A grid centres its children on the inline axis
 * alone, while a screen has to centre on the block axis too — which is the flex column's own
 * `justify-content`. Only this mode changes the display model; a default stack stays a grid.
 */
const centredStyles = cx('flex flex-col items-center justify-center text-center', 'py-[var(--s8)]');

/** The spacing steps: one per gap, `md` matching the base line height, `xl` the section rhythm. */
const gapStyles: Record<StackGap | 'xl', string> = {
  sm: 'gap-[var(--s1)]',
  md: 'gap-[var(--s2)]',
  lg: 'gap-[var(--s4)]',
  xl: 'gap-[var(--s6)]',
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
  centred = false,
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
        centred && 'ui-stack--centred',
        centred ? centredStyles : stackStyles,
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
