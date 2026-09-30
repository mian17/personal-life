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

export function EditorToolbar({ back, title, status, actions, className }: EditorToolbarProps) {
  return (
    <div className={cx('ui-editor-toolbar', className)}>
      <IconButton label={back.label} onClick={back.onBack}>
        <ChevronLeft size={20} aria-hidden />
      </IconButton>
      {title != null ? (
        <h1 className="ui-editor-toolbar__title">{title}</h1>
      ) : (
        status
      )}
      {actions}
    </div>
  );
}
