import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import { IconButton } from './icon-button';

export interface EditorToolbarBack {
  label: string;
  onBack: () => void;
}

export interface EditorToolbarProps {
  back: EditorToolbarBack;
  /** A centred screen title. Rendered as a real `<h1>`, so every editor screen
   *  has a heading (create/edit screens are otherwise headed-less). */
  title?: ReactNode;
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

export function EditorToolbar({ back, title, status, actions, className }: Readonly<EditorToolbarProps>) {
  return (
    <div className={cx('ui-editor-toolbar', toolbarStyles, className)}>
      <IconButton label={back.label} onClick={back.onBack}>
        <ChevronLeft size={20} aria-hidden />
      </IconButton>
      {title != null ? (
        <h1 className={cx('ui-editor-toolbar__title', titleStyles)}>{title}</h1>
      ) : (
        status
      )}
      {actions}
    </div>
  );
}
