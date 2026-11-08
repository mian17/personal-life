// Composed from the registry `card` (plan Decision 4): shadcn ships no empty-state
// item, so this block is Card's box with a centred copy layout inside it.
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Card } from './card';
import { cx } from '../lib/cx';

export interface EmptyStateProps extends ComponentPropsWithRef<'div'> {
  heading?: ReactNode;
  body: ReactNode;
}

/**
 * §8's `.empty`: the panel keeps Card's surface and hairline — an empty state is still a box
 * on the page — and takes the reference's taller block inset. Padding is split into
 * inline/block utilities so it replaces Card's `p-…` instead of competing with it.
 */
const layoutStyles = 'px-[var(--s4)] py-[var(--s8)] text-center';

/** §8's `.empty__title`: the row-title size and weight, on the primary ink. */
const headingStyles = 'm-0 text-[length:var(--fs-row-title)] font-semibold text-ink';

/** §8's `.empty__body`: one step down, muted, tucked under the heading. */
const bodyStyles = 'm-0 mt-[var(--s1)] text-[length:var(--fs-chip)] text-ink-2';

export function EmptyState({ heading, body, className, ...rest }: Readonly<EmptyStateProps>) {
  return (
    <Card className={cx('ui-empty', layoutStyles, className)} {...rest}>
      {heading != null && <p className={headingStyles}>{heading}</p>}
      <p className={bodyStyles}>{body}</p>
    </Card>
  );
}
