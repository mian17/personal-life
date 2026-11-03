import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../lib/cx';

export type FactsProps = ComponentPropsWithRef<'div'>;

export interface FactsRowProps {
  /** The fact's name (left column) — app-supplied copy. */
  label: ReactNode;
  /** The fact's read-out (right column), already formatted. */
  value: ReactNode;
  /** Class passthrough. */
  className?: string;
}

/** §8's `.facts`: the rows stack into one column. */
const factsStyles = 'grid';

/** §8's `.fact`: baseline row, hairline under every row but the last. */
const rowStyles =
  'flex items-baseline justify-between gap-[var(--s4)] py-[var(--s3)] border-b border-line last:border-b-0 text-[length:var(--fs-chip)]';

/** §8's `.fact__v`: the read-out sits in the second ink tier with tabular figures. */
const valueStyles = 'text-ink-2 tabular-nums';

/** The label–value list on a detail screen. Layout only; the rows carry the content. */
export function Facts({ className, children, ...rest }: Readonly<FactsProps>) {
  return (
    <div className={cx('ui-facts', factsStyles, className)} {...rest}>
      {children}
    </div>
  );
}

/** One fact: label on the left, value on the right, hairline below unless it is the last row. */
export function FactsRow({ label, value, className }: Readonly<FactsRowProps>) {
  return (
    <div className={cx('ui-fact', rowStyles, className)}>
      <span className="ui-fact__label">{label}</span>
      <span className={cx('ui-fact__v', valueStyles)}>{value}</span>
    </div>
  );
}
