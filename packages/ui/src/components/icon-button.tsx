import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type IconButtonVariant = 'default' | 'ghost';

export interface IconButtonProps extends ComponentPropsWithRef<'button'> {
  label: string;
  variant?: IconButtonVariant;
}

export function IconButton({
  label,
  variant = 'default',
  className,
  children,
  ...rest
}: Readonly<IconButtonProps>) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cx('ui-icon-btn', variant !== 'default' && `ui-icon-btn--${variant}`, className)}
      {...rest}
    >
      {children}
    </button>
  );
}
