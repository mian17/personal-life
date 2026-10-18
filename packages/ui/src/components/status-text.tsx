import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type StatusTextSize = 'default' | 'display';

export interface StatusTextProps extends ComponentPropsWithRef<'span'> {
  /** `'display'` scales a short read-out, e.g. a countdown's digits. */
  size?: StatusTextSize;
}

export function StatusText({
  size = 'default',
  className,
  children,
  ...rest
}: StatusTextProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cx(
        'ui-status-text',
        size === 'display' && 'ui-status-text--display',
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
