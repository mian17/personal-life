import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type PageTitleProps = ComponentPropsWithRef<'h1'>;

export function PageTitle({ className, children, ...rest }: PageTitleProps) {
  return (
    <h1 className={cx('ui-page-title', className)} {...rest}>
      {children}
    </h1>
  );
}
