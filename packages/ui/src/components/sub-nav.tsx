import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface SubNavProps extends Omit<ComponentPropsWithRef<'nav'>, 'children'> {
  /** The parent screen's route. A literal destination, so back survives a cold load. */
  backHref: string;
  /** The parent screen's word — the anchor's visible text and the landmark's name. */
  backLabel: string;
  /** The current screen's name, read back at the row's far end. Omitted, the row ends at the link. */
  status?: ReactNode;
}

/**
 * §8's `.subnav`: one row above a sub-view's heading, the way back on the left and the
 * screen's own name on the right. `min-height` is the tap floor, so the row never shrinks
 * below the target its link needs.
 */
const rowStyles = 'flex items-center gap-[var(--s2)] min-h-[var(--tap)] pt-[var(--s2)]';

/**
 * §8's `.backlink`: the chevron and the parent's word on one line. The negative start margin
 * pulls the label's text edge back onto the panel's own inset, so the word — not the padding —
 * aligns with the heading below it.
 */
const backLinkStyles = cx(
  'inline-flex items-center gap-[var(--s2)] min-h-[var(--tap)]',
  '-ml-[var(--s2)] px-[var(--s2)] rounded-[var(--r-md)]',
  'text-ink text-[length:var(--fs-row-title)] font-semibold no-underline',
  'outline-none motion-safe:transition-colors active:bg-press',
  'focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)]',
  'focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-focus',
);

/** §8's `.status`: the screen's name at the meta tier, never louder than the heading. */
const statusStyles = 'ml-auto text-[length:var(--fs-meta)] text-ink-2';

/**
 * The row a sub-view opens with: a text back link and, optionally, the view's name. The link
 * is a real anchor to a caller-owned destination — a `router.back()` would land nowhere after
 * a cold load.
 */
export function SubNav({ backHref, backLabel, status, className, ...rest }: Readonly<SubNavProps>) {
  return (
    <nav aria-label={`Back to ${backLabel}`} className={cx('ui-sub-nav', rowStyles, className)} {...rest}>
      <Link href={backHref} className={cx('ui-sub-nav__back', backLinkStyles)}>
        <ChevronLeft size={20} aria-hidden />
        {backLabel}
      </Link>
      {status != null && <span className={cx('ui-sub-nav__status', statusStyles)}>{status}</span>}
    </nav>
  );
}
