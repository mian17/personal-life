import Link from 'next/link';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface FabLinkProps extends Omit<ComponentPropsWithRef<'a'>, 'href' | 'children'> {
  href: string;
  label: string;
  children: ReactNode;
}

/**
 * The registry button's `asChild` shape at the page's fixed corner: the visual classes land on
 * the anchor itself, so the control stays a link to assistive tech — never a `<button>` wrapped
 * in one.
 *
 * A class string rather than `buttonVariants`, because `cx` joins classes without merging them:
 * the cva base's `rounded-md` would follow this rule in the utilities layer and win the cascade
 * over the pill radius. Same reason `icon-link` states its own look.
 *
 * ponytail: the accent pair repeats `buttonVariants`' `primary` variant; share it once `cx`
 * learns to merge.
 */
const fabLinkStyles = cx(
  'fixed z-10',
  'right-[calc(var(--space-1)+env(safe-area-inset-right))]',
  'bottom-[calc(var(--space-1)+env(safe-area-inset-bottom))]',
  'inline-flex items-center justify-center size-[var(--fab-size)] rounded-full',
  'bg-accent text-on-accent no-underline shadow-[var(--shadow-fab)]',
  'outline-none transition-colors',
  // `outline-none` zeroes the style variable an outline width draws with, so the ring
  // needs its style back; width and offset both ride the `--focus-ring` token.
  'focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)]',
  'focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-accent',
);

export function FabLink({ href, label, className, children, ...rest }: Readonly<FabLinkProps>) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={cx('ui-fab-link', fabLinkStyles, className)}
      {...rest}
    >
      {children}
    </Link>
  );
}
