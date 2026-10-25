import Link from 'next/link';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface IconLinkProps extends Omit<ComponentPropsWithRef<'a'>, 'href' | 'children'> {
  href: string;
  label: string;
  children: ReactNode;
}

export function IconLink({ href, label, className, children, ...rest }: Readonly<IconLinkProps>) {
  return (
    <Link href={href} aria-label={label} className={cx('ui-icon-link', className)} {...rest}>
      {children}
    </Link>
  );
}
