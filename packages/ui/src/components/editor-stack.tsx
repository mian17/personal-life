// Composed from utilities (plan Decision 4): shadcn ships no editor-stack item,
// so this atom keeps its markup and takes its rhythm from the token gap scale.
import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';
import type { StackGap } from './stack';

export interface EditorStackProps extends ComponentPropsWithRef<'div'> {
  gap?: StackGap;
}

/**
 * The body area under the toolbar: it fills the height the editor screen hands
 * it and scrolls its own overflow instead of pushing the page taller.
 */
const bodyStyles = 'flex min-h-0 flex-1 flex-col';

/**
 * Breathing room between the toolbar and the first field. The toolbar's own bottom
 * margin is small (the notes editor shares it), so the editor body owns the larger
 * separation.
 */
const toolbarGapStyles = 'mt-[var(--s2)]';

/** The field rhythm is `Stack`'s, so an editor and a screen space their children alike. */
const gapStyles: Record<StackGap, string> = {
  sm: 'gap-[var(--s1)]',
  md: 'gap-[var(--s2)]',
  lg: 'gap-[var(--s4)]',
};

/**
 * A full-height stack of an editor's fields with the token gap scale, so an
 * editor never hand-stacks bare controls. Owns no padding — `EditorScreen` does.
 */
export function EditorStack({ gap = 'lg', className, children, ...rest }: Readonly<EditorStackProps>) {
  return (
    <div
      className={cx(
        'ui-editor-stack',
        `ui-editor-stack--${gap}`,
        bodyStyles,
        toolbarGapStyles,
        gapStyles[gap],
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
