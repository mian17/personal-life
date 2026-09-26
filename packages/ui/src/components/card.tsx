import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type CardProps = ComponentPropsWithRef<'div'>;

export function Card({ className, children, ...rest }: CardProps) {
  return (
    <div className={cx('ui-card', className)} {...rest}>
      {children}
    </div>
  );
}
