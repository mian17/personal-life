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
    <section className={cx('ui-section', className)} {...rest}>
      {label != null && (
        <div className="ui-section__heading-row">
          <Heading className="ui-section__heading">{label}</Heading>
          {actions != null && <div className="ui-section__actions">{actions}</div>}
        </div>
      )}
      <Stack gap={gap}>{children}</Stack>
    </section>
  );
}
