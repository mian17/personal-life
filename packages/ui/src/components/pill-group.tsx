import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface PillGroupProps extends ComponentPropsWithRef<'div'> {
  label?: ReactNode;
  actions?: ReactNode;
}

export function PillGroup({ label, actions, className, children, ...rest }: Readonly<PillGroupProps>) {
  return (
    <div className={cx('ui-pill-group', className)} {...rest}>
      {label != null && <span className="ui-pill-group__label">{label}</span>}
      {children}
      {actions != null && <span className="ui-pill-group__actions">{actions}</span>}
    </div>
  );
}
