import { useId } from 'react';
import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface ScreenProps {
  /**
   * The panel's accessible name, rendered as a visually hidden `<h2>` and wired to the section
   * through `aria-labelledby`. Omit it when the panel already carries a visible heading — the
   * complete screen's title — and the section then has no name at all.
   */
  label?: string;
  /** `stack` is a form column; `centred` is a resting screen — a countdown or a result. */
  layout?: 'stack' | 'centred';
  children: ReactNode;
}

/** The idle form: a column whose children keep their own order and spacing. */
const stackStyles = 'flex flex-col gap-[var(--s5)]';

/**
 * A resting screen: the column centres inside the block size its shell gives it, and claims no
 * height of its own — a `Screen` is structure, not a box.
 */
const centredStyles =
  'flex flex-col items-center justify-center gap-[var(--s6)] py-[var(--s8)] text-center';

const layoutStyles: Record<NonNullable<ScreenProps['layout']>, string> = {
  stack: stackStyles,
  centred: centredStyles,
};

/**
 * One screen of a multi-state surface — the idle form, the running panel, the result. The
 * visible name lives in a real heading and the accessible one in `aria-labelledby`, so the
 * section's name and the document outline can never disagree: the heading is `h2` because the
 * page's `h1` is the shell's title, and the pair is what makes the outline read the way the
 * screen looks.
 *
 * No `role`, no tab stop and no live region: the primitive owns no behaviour and no visibility,
 * so a caller renders exactly one screen at a time rather than flipping `hidden`.
 */
export function Screen({ label, layout = 'stack', children }: Readonly<ScreenProps>) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={label == null ? undefined : headingId}
      className={cx('ui-screen', `ui-screen--${layout}`, layoutStyles[layout])}
    >
      {label != null && (
        <h2 id={headingId} className="ui-screen__heading sr-only">
          {label}
        </h2>
      )}
      {children}
    </section>
  );
}
