import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'quiet';
export type ButtonSize = 'default' | 'bare' | 'icon';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = 'primary',
  size = 'default',
  type = 'button',
  className,
  children,
  ...rest
}: Readonly<ButtonProps>) {
  return (
    <button
      type={type}
      className={cx('ui-btn', `ui-btn--${variant}`, `ui-btn--${size}`, className)}
      {...rest}
    >
      {children}
    </button>
  );
}
