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
 * The panel surface Card paints would read as a filled box behind centred copy,
 * so the layout cancels the fill and its border and keeps only the block's own
 * breathing room. Padding is split into inline/block utilities so it replaces
 * Card's `p-…` instead of competing with it.
 */
const layoutStyles =
  'border-0 bg-transparent px-[var(--space-1)] py-[var(--space-3)] text-center';

/**
 * Muted copy with the tight margin the block always had. The colour rides the
 * paragraphs rather than the box: Card already sets a text colour on the box,
 * and a second one there would race it.
 */
const paragraphStyles = 'm-[var(--space-0-25)_0] text-muted';

export function EmptyState({ heading, body, className, ...rest }: Readonly<EmptyStateProps>) {
  return (
    <Card className={cx('ui-empty', layoutStyles, className)} {...rest}>
      {heading != null && <p className={paragraphStyles}>{heading}</p>}
      <p className={paragraphStyles}>{body}</p>
    </Card>
  );
}
