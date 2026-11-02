import Link from 'next/link';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface FabLinkProps extends Omit<ComponentPropsWithRef<'a'>, 'href' | 'children'> {
  href: string;
  label: string;
  children: ReactNode;
}

/**
 * The page's one action, held at the frame's bottom-right corner: clear of the safe area, and
 * inset from the viewport edge only while the viewport is wider than the frame. The visual
 * classes land on the anchor itself, so the control stays a link to assistive tech — never a
 * `<button>` wrapped in one.
 *
 * A class string rather than `buttonVariants`, because `cx` joins classes without merging them:
 * the cva base's `rounded-md` would follow this rule in the utilities layer and win the cascade
 * over the pill radius. Same reason `icon-link` states its own look.
 *
 * ponytail: the accent pair repeats `buttonVariants`' `primary` variant; share it once `cx`
 * learns to merge.
 */
const fabLinkStyles = cx(
  'fixed z-30',
  'right-[max(var(--s4),calc((100vw_-_var(--frame-max))/2_+_var(--s4)))]',
  'bottom-[calc(env(safe-area-inset-bottom)+var(--s4))]',
  'inline-flex items-center justify-center size-[var(--fab-size)] rounded-full',
  'border border-max bg-max text-on-max no-underline active:bg-max-press',
  'outline-none motion-safe:transition-colors',
  // `outline-none` zeroes the style variable an outline width draws with, so the ring
  // needs its style back; width and offset both ride the `--focus-ring` token.
  'focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)]',
  'focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-max',
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
