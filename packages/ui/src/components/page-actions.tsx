import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type PageActionsProps = ComponentPropsWithRef<'div'>;

export function PageActions({ className, children, ...rest }: PageActionsProps) {
  return (
    <div className={cx('ui-page-actions', className)} {...rest}>
      {children}
    </div>
  );
}
