import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type ListProps = ComponentPropsWithRef<'ul'>;

/**
 * §8's `.group`: the rows share one bordered surface, clipped at the group radius, with a
 * hairline between neighbours. A `<ul>` also carries the browser's own bullet, indent and
 * margin — `base.css` only resets the document box — so the list clears those itself.
 */
const groupStyles = cx(
  'list-none m-0 p-0',
  'bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden',
  'divide-y divide-line',
);

export function List({ className, children, ...rest }: ListProps) {
  return (
    <ul className={cx('ui-list', groupStyles, className)} {...rest}>
      {children}
    </ul>
  );
}
