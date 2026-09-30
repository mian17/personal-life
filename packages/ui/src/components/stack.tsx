import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type StackGap = 'sm' | 'md' | 'lg';

export interface StackProps extends ComponentPropsWithRef<'div'> {
  gap?: StackGap;
  as?: 'div';
}

export function Stack({ gap = 'md', as = 'div', className, children, ...rest }: StackProps) {
  const Tag = as;
  return (
    <Tag className={cx('ui-stack', `ui-stack--${gap}`, className)} {...rest}>
      {children}
    </Tag>
  );
}
