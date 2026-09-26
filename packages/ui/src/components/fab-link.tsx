import Link from 'next/link';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface FabLinkProps extends Omit<ComponentPropsWithRef<'a'>, 'href' | 'children'> {
  href: string;
  label: string;
  children: ReactNode;
}

export function FabLink({ href, label, className, children, ...rest }: FabLinkProps) {
  return (
    <Link href={href} aria-label={label} className={cx('ui-fab-link', className)} {...rest}>
      {children}
    </Link>
  );
}
