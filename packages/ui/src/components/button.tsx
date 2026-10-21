import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'quiet';
export type ButtonSize = 'default' | 'bare' | 'icon';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Hide the control but keep its box (and its height) in the layout, so a
   * caller that swaps it out does not shift its neighbours. Hidden this way it
   * is not focusable and is absent from the accessibility tree.
   */
  invisible?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'default',
  invisible,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'ui-btn',
        `ui-btn--${variant}`,
        `ui-btn--${size}`,
        invisible && 'ui-invisible',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
