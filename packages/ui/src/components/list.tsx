import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type ListProps = ComponentPropsWithRef<'ul'>;

/**
 * A `<ul>` carries the browser's own bullet, indent and margin — `base.css` only resets the
 * document box — so the list clears them itself and stacks its rows on the token gap scale.
 */
const listStyles = cx('list-none m-0 p-0', 'grid gap-[var(--space-0-5)]');

export function List({ className, children, ...rest }: ListProps) {
  return (
    <ul className={cx('ui-list', listStyles, className)} {...rest}>
      {children}
    </ul>
  );
}
