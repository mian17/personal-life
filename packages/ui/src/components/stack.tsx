import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type StackGap = 'sm' | 'md' | 'lg';

export type StackAlign = 'start' | 'center' | 'end';

export type StackVAlign = 'start' | 'center' | 'end';

export interface StackProps extends ComponentPropsWithRef<'div'> {
  gap?: StackGap;
  align?: StackAlign;
  /**
   * Block-axis distribution of the rows (`align-content`). Only visible when the
   * stack is taller than its content, i.e. inside a full-height page.
   */
  vAlign?: StackVAlign;
  as?: 'div';
}

export function Stack({
  gap = 'md',
  align = 'start',
  vAlign = 'start',
  as = 'div',
  className,
  children,
  ...rest
}: StackProps) {
  const Tag = as;
  return (
    <Tag
      className={cx('ui-stack', `ui-stack--${gap}`, alignClass(align), vAlignClass(vAlign), className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * Only a non-default alignment renames the class: `start` is the grid's own
 * behaviour, so a default Stack renders exactly the classes it always did.
 */
function alignClass(align: StackAlign): string | undefined {
  return align === 'start' ? undefined : `ui-stack--${align}`;
}

/** The block-axis twin of `alignClass`, with its own `v` prefix so the names never collide. */
function vAlignClass(vAlign: StackVAlign): string | undefined {
  return vAlign === 'start' ? undefined : `ui-stack--v-${vAlign}`;
}
