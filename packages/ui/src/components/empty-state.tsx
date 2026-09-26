import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface EmptyStateProps extends ComponentPropsWithRef<'div'> {
  heading?: ReactNode;
  body: ReactNode;
}

export function EmptyState({ heading, body, className, ...rest }: EmptyStateProps) {
  return (
    <div className={cx('ui-empty', className)} {...rest}>
      {heading != null && <p>{heading}</p>}
      <p>{body}</p>
    </div>
  );
}
