import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type StatusTextProps = ComponentPropsWithRef<'span'>;

export function StatusText({ className, children, ...rest }: StatusTextProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cx('ui-status-text', className)}
      {...rest}
    >
      {children}
    </span>
  );
}
