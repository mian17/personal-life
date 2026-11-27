import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../lib/cx';
import { Stack, type StackGap } from './stack';

export type SectionHeadingLevel = 'h2' | 'h3';

export interface SectionProps extends ComponentPropsWithRef<'section'> {
  label?: ReactNode;
  /** §8's `.slabel__count`: how many rows the group holds, read at the heading row's far end. */
  count?: ReactNode;
  headingLevel?: SectionHeadingLevel;
  actions?: ReactNode;
  gap?: StackGap;
  /** `false` drops the section's own top margin, for a label inside a sheet body. Default `true`. */
  margin?: boolean;
  /** The label's ink tier. `ink-2` is every shipped section; `ink-3` is the sheet's quieter one. */
  labelTone?: 'ink-2' | 'ink-3';
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
const labelStyles = cx(
  'flex items-baseline gap-[var(--s2)]',
  '[&>:is(h2,h3)]:m-0',
  '[&>:is(h2,h3)]:text-[length:var(--fs-section-label)]',
  '[&>:is(h2,h3)]:[font-weight:var(--fw-section-label)]',
  '[&>:is(h2,h3)]:tracking-[var(--tracking-section-label)]',
  '[&>:is(h2,h3)]:uppercase',
);

/**
 * The label's ink, one tier per tone. The ink rides a descendant selector on the heading row, so a
 * second tier must replace that utility rather than join it: two of them would contest one colour
 * and the stylesheet's order would decide which reads.
 */
const headingRowStyles: Record<NonNullable<SectionProps['labelTone']>, string> = {
  'ink-2': cx(labelStyles, '[&>:is(h2,h3)]:text-ink-2'),
  'ink-3': cx(labelStyles, '[&>:is(h2,h3)]:text-ink-3'),
};

/** The label's own bottom gap, so a section without a label is not pushed down by one. */
const labelledStyles = 'mb-[var(--s2)]';

/** The action slot takes the row's leftover width, so it sits at the far end. */
const actionsStyles = 'ml-auto';

/**
 * §8's `.slabel__count`: one step below the label, un-uppercased, and quiet. `normal-case` is
 * stated rather than inherited — the row's uppercase treatment is scoped to the heading, and the
 * count must stay un-uppercased if that ever widens.
 */
const countStyles = cx(
  'text-[length:var(--fs-count)]',
  '[font-weight:var(--fw-semibold)]',
  'tracking-[var(--tracking-count)]',
  'normal-case',
  'text-ink-3',
);

/** `.slabel` is space-between: the count holds the far end only while no action does. */
const countFarEndStyles = 'ml-auto';

export function Section({
  label,
  count,
  headingLevel = 'h2',
  actions,
  gap = 'md',
  margin = true,
  labelTone = 'ink-2',
  className,
  children,
  ...rest
}: Readonly<SectionProps>) {
  const Heading = headingLevel;
  return (
    <section
      className={cx('ui-section', margin && sectionStyles, autoHideStyles, className)}
      {...rest}
    >
      {label != null && (
        <div className={cx('ui-section__heading-row', headingRowStyles[labelTone], labelledStyles)}>
          <Heading className="ui-section__heading">{label}</Heading>
          {count != null && (
            <span
              className={cx('ui-section__count', countStyles, actions == null && countFarEndStyles)}
            >
              {count}
            </span>
          )}
          {actions != null && (
            <div className={cx('ui-section__actions', actionsStyles)}>{actions}</div>
          )}
        </div>
      )}
      <Stack gap={gap}>{children}</Stack>
    </section>
  );
}
