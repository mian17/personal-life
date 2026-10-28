// shadcn/ui registry copy (`button`), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
import Link from 'next/link';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { buttonVariants, type ButtonSize, type ButtonVariant } from './button';
import { cx } from '../lib/cx';

export interface ButtonLinkProps extends Omit<ComponentPropsWithRef<'a'>, 'href' | 'children'> {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/**
 * The registry button's `asChild` shape: the visual classes land on the anchor
 * itself, so the control stays a link to assistive tech — never a `<button>`
 * wrapped in one.
 */
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
      className={cx(
        'ui-btn',
        `ui-btn--${variant}`,
        `ui-btn--${size}`,
        buttonVariants({ variant, size }),
        'no-underline',
        className,
      )}
      {...rest}
    >
      {children}
    </Link>
  );
}
