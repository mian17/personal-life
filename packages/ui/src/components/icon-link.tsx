// shadcn/ui registry copy (`button`), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
import Link from 'next/link';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface IconLinkProps extends Omit<ComponentPropsWithRef<'a'>, 'href' | 'children'> {
  href: string;
  label: string;
  children: ReactNode;
}

/**
 * The registry button's `asChild` shape at this atom's 40px square: one fixed
 * look, so a class string — no cva.
 *
 * ponytail: the string repeats IconButton's `default` variant, which is not
 * exported; lift it into a shared `iconControlVariants` if a third consumer
 * appears.
 */
const iconLinkStyles =
  'inline-flex size-10 items-center justify-center rounded-md border border-border bg-panel text-text no-underline outline-none motion-safe:transition-colors focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)] focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-accent [-webkit-tap-highlight-color:transparent]';

export function IconLink({ href, label, className, children, ...rest }: Readonly<IconLinkProps>) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={cx('ui-icon-link', iconLinkStyles, className)}
      {...rest}
    >
      {children}
    </Link>
  );
}
