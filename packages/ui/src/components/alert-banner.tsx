import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../lib/cx';

export type AlertBannerTone = 'warning';

export interface AlertBannerProps extends ComponentPropsWithRef<'div'> {
  tone?: AlertBannerTone;
  actions?: ReactNode;
}

export function AlertBanner({
  tone = 'warning',
  actions,
  className,
  children,
  ...rest
}: AlertBannerProps) {
  return (
    <div className={cx('ui-alert-banner', `ui-alert-banner--${tone}`, className)} {...rest}>
      <p className="ui-alert-banner__text">{children}</p>
      {actions != null && <div className="ui-alert-banner__actions">{actions}</div>}
    </div>
  );
}
