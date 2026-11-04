// shadcn/ui registry copy (`button`), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
import Link from 'next/link';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../lib/cx';

export type IconLinkVariant = 'framed' | 'bare';

export interface IconLinkProps extends Omit<ComponentPropsWithRef<'a'>, 'href' | 'children'> {
  href: string;
  label: string;
  children: ReactNode;
  /** `framed` draws the hairline square; `bare` is §8's `.iconbtn` — same target, no chrome. */
  variant?: IconLinkVariant;
}

/**
 * The registry button's `asChild` shape at the icon control's tap target: a 48px square on
 * `IconButton`'s radius. Both variants share the target, the radius, the ink, the focus ring and
 * the `--press` wash; only the frame differs.
 *
 * Two fixed looks, so class strings composed with `cx` — no cva.
 */
const iconLinkBaseStyles =
  'inline-flex size-[var(--tap)] items-center justify-center rounded-[var(--r-md)] text-ink no-underline outline-none motion-safe:transition-colors active:bg-press focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)] focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-focus [-webkit-tap-highlight-color:transparent]';

/** `--line` hairline on `--surface`, the default control face. */
const iconLinkFramedStyles = cx(iconLinkBaseStyles, 'border border-line bg-surface');

/** §8's `.iconbtn`: the same target with no border and no fill. */
const iconLinkBareStyles = cx(iconLinkBaseStyles, 'border-0 bg-transparent');

const iconLinkVariantStyles: Record<IconLinkVariant, string> = {
  framed: iconLinkFramedStyles,
  bare: iconLinkBareStyles,
};

export function IconLink({
  href,
  label,
  variant = 'framed',
  className,
  children,
  ...rest
}: Readonly<IconLinkProps>) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={cx('ui-icon-link', `ui-icon-link--${variant}`, iconLinkVariantStyles[variant], className)}
      {...rest}
    >
      {children}
    </Link>
  );
}
