import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import { IconButton, type IconButtonVariant } from './icon-button';

export interface EditorToolbarBack {
  label: string;
  onBack: () => void;
  /** The back control's face; omitted, the control stays the borderless `.iconbtn`. */
  variant?: IconButtonVariant;
}

export interface EditorToolbarProps {
  back: EditorToolbarBack;
  /** A centred screen title. Rendered as a real `<h1>`, so every editor screen
   *  has a heading (create/edit screens are otherwise headed-less). */
  title?: ReactNode;
  /** §6's `.row__meta` tier beneath the title — the record's meta line (e.g. "Thursday, 30
   *  October · 12:40"). */
  sub?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * One row: back control, then the middle slot, then the actions, pushed to the far edge. It is a
 * tap target tall, so the row keeps the frame's rhythm whether the middle slot holds a heading or
 * a status read-out.
 */
const toolbarStyles = cx(
  'flex items-center justify-between gap-[var(--s2)]',
  'min-h-[var(--tap)] mb-[var(--s2)]',
);

/** Sized below the list `PageTitle` (an editor is a sub-screen), centred between the two controls. */
const titleStyles = cx(
  'flex-1 min-w-0 m-0 text-center',
  'text-[length:var(--fs-row-title)] leading-[var(--lh-row-title)]',
  'tracking-[var(--tracking-row-title)] font-semibold',
);

/** The middle slot stacks the heading over its sub-line, so both stay centred as one block. */
const middleColumnStyles = 'flex flex-col items-center flex-1 min-w-0';

/** §6's `.row__meta`: the quiet second line, one `--s2` under the title. */
const subStyles = cx(
  'm-0 mt-[var(--s2)]',
  'text-[length:var(--fs-meta)] leading-[var(--lh-meta)] text-ink-2',
);

export function EditorToolbar({
  back,
  title,
  sub,
  status,
  actions,
  className,
}: Readonly<EditorToolbarProps>) {
  const middle =
    title != null ? (
      <h1 className={cx('ui-editor-toolbar__title', titleStyles)}>{title}</h1>
    ) : (
      status
    );

  return (
    <div className={cx('ui-editor-toolbar', toolbarStyles, className)}>
      <IconButton label={back.label} variant={back.variant} onClick={back.onBack}>
        <ChevronLeft size={20} aria-hidden />
      </IconButton>
      {sub != null ? (
        <div className={cx('ui-editor-toolbar__main', middleColumnStyles)}>
          {middle}
          <div className={cx('ui-editor-toolbar__sub', subStyles)}>{sub}</div>
        </div>
      ) : (
        middle
      )}
      {actions}
    </div>
  );
}
