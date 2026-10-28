import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type StatusTextSize = 'default' | 'display';

export interface StatusTextProps extends ComponentPropsWithRef<'span'> {
  /** `'display'` scales a short read-out, e.g. a countdown's digits. */
  size?: StatusTextSize;
  /** Hide the line but keep its height reserved (`visibility: hidden`, not `display: none`). */
  invisible?: boolean;
}

/**
 * `invisible` is Tailwind's `visibility: hidden`, never `display: none`: a caller hides the line
 * precisely to stop the layout moving, so the box has to stay. `ui-invisible` rides along as the
 * hook `apps/pomodoro` asserts on the rendered line.
 */
const sizeStyles: Record<StatusTextSize, string> = {
  default: 'text-[length:var(--space-0-85)]',
  display: 'text-[length:var(--space-3)]',
};

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
        'ui-status-text text-muted',
        sizeStyles[size],
        size === 'display' && 'ui-status-text--display',
        invisible && 'ui-invisible invisible',
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
