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
 * The registry button's `asChild` shape at the icon control's tap target: a 48px square on
 * `IconButton`'s radius, drawn as the framed variant of that control — `--line` hairline,
 * `--surface` fill, `--ink` glyph, washing to `--press` under the finger.
 *
 * One fixed look, so a class string — no cva.
 */
const iconLinkStyles =
  'inline-flex size-[var(--tap)] items-center justify-center rounded-[var(--r-md)] border border-line bg-surface text-ink no-underline outline-none motion-safe:transition-colors active:bg-press focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)] focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-focus [-webkit-tap-highlight-color:transparent]';

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
