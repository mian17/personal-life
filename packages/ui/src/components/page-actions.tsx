import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type PageActionsProps = ComponentPropsWithRef<'div'>;

/**
 * Page furniture: the page's own controls pushed to the trailing edge. §8's `.subfoot` gives
 * the band above the control its own breathing room, so the block never crowds the list.
 */
const pageActionsStyles = 'flex justify-end mt-[var(--s6)] pt-[var(--s4)] border-t border-line';

export function PageActions({ className, children, ...rest }: PageActionsProps) {
  return (
    <div className={cx('ui-page-actions', pageActionsStyles, className)} {...rest}>
      {children}
    </div>
  );
}
