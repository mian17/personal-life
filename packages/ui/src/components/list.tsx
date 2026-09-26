import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type ListProps = ComponentPropsWithRef<'ul'>;

export function List({ className, children, ...rest }: ListProps) {
  return (
    <ul className={cx('ui-list', className)} {...rest}>
      {children}
    </ul>
  );
}
