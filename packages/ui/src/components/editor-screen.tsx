import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type EditorScreenProps = ComponentPropsWithRef<'div'>;

/**
 * Full-height column: the screen owns the page height, so the editor body below the
 * toolbar scrolls inside it. The padding clears the notch and the home indicator.
 */
const screenStyles = [
  'flex flex-col min-h-[100dvh]',
  'pt-[max(var(--space-0-75),env(safe-area-inset-top))] pb-[calc(var(--space-1)+env(safe-area-inset-bottom))]',
  'px-[var(--space-1)]',
].join(' ');

export function EditorScreen({ className, children, ...rest }: EditorScreenProps) {
  return (
    <div className={cx('ui-editor-screen', screenStyles, className)} {...rest}>
      {children}
    </div>
  );
}
