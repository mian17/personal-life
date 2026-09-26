import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type EditorScreenProps = ComponentPropsWithRef<'div'>;

export function EditorScreen({ className, children, ...rest }: EditorScreenProps) {
  return (
    <div className={cx('ui-editor-screen', className)} {...rest}>
      {children}
    </div>
  );
}
