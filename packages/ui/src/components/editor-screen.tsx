import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type EditorScreenProps = ComponentPropsWithRef<'div'>;

/**
 * Full-height column: the screen owns the page height, so the editor body below the
 * toolbar scrolls inside it. The padding is the frame's `--s4` inset, and it clears the
 * notch and the home indicator.
 *
 * The top inset is the siblings' two steps spelled out in one place: a list screen is
 * `PageShell`'s `--s4` plus `NavBar`'s `--s2`, so its back control sits 24px down. The editor's
 * toolbar draws no top margin of its own, so the frame has to carry both steps or the one
 * universal control jumps 12px when the user opens a note. The safe-area term is maxed against
 * `--s4` before `--s2` is added, so a notched device keeps the same 8px step as the siblings.
 */
const screenStyles = [
  'flex flex-col min-h-[100dvh]',
  'pt-[calc(max(var(--s4),env(safe-area-inset-top))+var(--s2))] pb-[calc(var(--s4)+env(safe-area-inset-bottom))]',
  'px-[var(--s4)]',
].join(' ');

export function EditorScreen({ className, children, ...rest }: EditorScreenProps) {
  return (
    <div className={cx('ui-editor-screen', screenStyles, className)} {...rest}>
      {children}
    </div>
  );
}
