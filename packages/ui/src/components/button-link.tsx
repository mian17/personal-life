import Link from 'next/link';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import type { ButtonSize, ButtonVariant } from './button';
import { cx } from '../lib/cx';

export interface ButtonLinkProps extends Omit<ComponentPropsWithRef<'a'>, 'href' | 'children'> {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function ButtonLink({
  href,
  variant = 'primary',
  size = 'default',
  className,
  children,
  ...rest
}: Readonly<ButtonLinkProps>) {
  return (
    <Link
      href={href}
      className={cx('ui-btn', `ui-btn--${variant}`, `ui-btn--${size}`, className)}
      {...rest}
    >
      {children}
    </Link>
  );
}
