import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type StackGap = 'sm' | 'md' | 'lg';

export type StackAlign = 'start' | 'center' | 'end';

export interface StackProps extends ComponentPropsWithRef<'div'> {
  gap?: StackGap;
  align?: StackAlign;
  as?: 'div';
}

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
    <Tag className={cx('ui-stack', `ui-stack--${gap}`, alignClass(align), className)} {...rest}>
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
