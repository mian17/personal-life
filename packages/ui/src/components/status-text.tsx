import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type StatusTextSize = 'default' | 'display';

export interface StatusTextProps extends ComponentPropsWithRef<'span'> {
  /** `'display'` scales a short read-out, e.g. a countdown's digits. */
  size?: StatusTextSize;
  /** Hide the line but keep its height reserved (`visibility: hidden`, not `display: none`). */
  invisible?: boolean;
}

export function StatusText({
  size = 'default',
  invisible,
  className,
  children,
  ...rest
}: Readonly<StatusTextProps>) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cx(
        'ui-status-text',
        size === 'display' && 'ui-status-text--display',
        invisible && 'ui-invisible',
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
