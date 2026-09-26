import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type PageShellProps = ComponentPropsWithRef<'main'>;

export function PageShell({ className, children, ...rest }: PageShellProps) {
  return (
    <main className={cx('ui-page', className)} {...rest}>
      {children}
    </main>
  );
}
