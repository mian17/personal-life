import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface PillGroupProps extends ComponentPropsWithRef<'div'> {
  label?: ReactNode;
  actions?: ReactNode;
}

/**
 * The row's own geometry as utilities: a wrapping flex row of pills behind a
 * hairline rule. The label and actions slots carry only their hooks — they read
 * as the row's own text, so no rule ever styled them.
 */
const rowStyles =
  'flex flex-wrap items-center gap-[var(--space-0-4)] mt-[var(--space-0-5)] pt-[var(--space-0-6)] border-t border-border';

export function PillGroup({ label, actions, className, children, ...rest }: Readonly<PillGroupProps>) {
  return (
    <div className={cx('ui-pill-group', rowStyles, className)} {...rest}>
      {label != null && <span className="ui-pill-group__label">{label}</span>}
      {children}
      {actions != null && <span className="ui-pill-group__actions">{actions}</span>}
    </div>
  );
}
