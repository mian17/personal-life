import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type EditorScreenProps = ComponentPropsWithRef<'div'>;

/**
 * Full-height column: the screen owns the page height, so the editor body below the
 * toolbar scrolls inside it. The padding is the frame's `--s4` inset, and it clears the
 * notch and the home indicator.
 */
const screenStyles = [
  'flex flex-col min-h-[100dvh]',
  'pt-[max(var(--s3),env(safe-area-inset-top))] pb-[calc(var(--s4)+env(safe-area-inset-bottom))]',
  'px-[var(--s4)]',
].join(' ');

export function EditorScreen({ className, children, ...rest }: EditorScreenProps) {
  return (
    <div className={cx('ui-editor-screen', screenStyles, className)} {...rest}>
      {children}
    </div>
  );
}
