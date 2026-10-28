import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type PageActionsProps = ComponentPropsWithRef<'div'>;

/** Page furniture: the page's own controls pushed to the trailing edge, clear of the content below. */
const pageActionsStyles = 'flex justify-end mt-[var(--space-1-25)]';

export function PageActions({ className, children, ...rest }: PageActionsProps) {
  return (
    <div className={cx('ui-page-actions', pageActionsStyles, className)} {...rest}>
      {children}
    </div>
  );
}
