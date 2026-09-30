import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';
import type { StackGap } from './stack';

export interface EditorStackProps extends ComponentPropsWithRef<'div'> {
  gap?: StackGap;
}

/**
 * The body area of an editor screen: a full-height vertical stack of fields with
 * the token gap scale, so an editor never hand-stacks bare controls. Fills the
 * remaining height under the toolbar (`flex: 1`) and owns no outer margins — the
 * `EditorScreen` provides the padding.
 */
export function EditorStack({ gap = 'lg', className, children, ...rest }: EditorStackProps) {
  return (
    <div className={cx('ui-editor-stack', `ui-editor-stack--${gap}`, className)} {...rest}>
      {children}
    </div>
  );
}
