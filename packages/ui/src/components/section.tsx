import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../lib/cx';
import { Stack, type StackGap } from './stack';

export type SectionHeadingLevel = 'h2' | 'h3';

export interface SectionProps extends ComponentPropsWithRef<'section'> {
  label?: ReactNode;
  headingLevel?: SectionHeadingLevel;
  actions?: ReactNode;
  gap?: StackGap;
}

/** The section is the only element here carrying an outer margin — its Stack has none. */
const sectionStyles = 'mt-[var(--s6)]';

/** A group whose every row was removed collapses with its list; a section that never had one is untouched. */
const autoHideStyles = '[&:has(.ui-list):not(:has(.ui-list-item))]:hidden';

/**
 * §8's `.slabel`: the small caps label that opens a group, its trailing action on the same
 * baseline. The type treatment rides the row's direct children, so the heading keeps its
 * `ui-section__heading` hook alone and the label markup stays exactly what locators read.
 */
const headingRowStyles = cx(
  'flex items-baseline gap-[var(--s2)]',
  '[&>:is(h2,h3)]:m-0',
  '[&>:is(h2,h3)]:text-[length:var(--fs-section-label)]',
  '[&>:is(h2,h3)]:[font-weight:var(--fw-section-label)]',
  '[&>:is(h2,h3)]:tracking-[var(--tracking-section-label)]',
  '[&>:is(h2,h3)]:uppercase',
  '[&>:is(h2,h3)]:text-ink-2',
);

/** The label's own bottom gap, so a section without a label is not pushed down by one. */
const labelledStyles = 'mb-[var(--s2)]';

/** The action slot takes the row's leftover width, so it sits at the far end. */
const actionsStyles = 'ml-auto';

export function Section({
  label,
  headingLevel = 'h2',
  actions,
  gap = 'md',
  className,
  children,
  ...rest
}: Readonly<SectionProps>) {
  const Heading = headingLevel;
  return (
    <section className={cx('ui-section', sectionStyles, autoHideStyles, className)} {...rest}>
      {label != null && (
        <div className={cx('ui-section__heading-row', headingRowStyles, labelledStyles)}>
          <Heading className="ui-section__heading">{label}</Heading>
          {actions != null && (
            <div className={cx('ui-section__actions', actionsStyles)}>{actions}</div>
          )}
        </div>
      )}
      <Stack gap={gap}>{children}</Stack>
    </section>
  );
}
