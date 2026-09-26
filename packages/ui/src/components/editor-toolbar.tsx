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
  status?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function EditorToolbar({ back, status, actions, className }: EditorToolbarProps) {
  return (
    <div className={cx('ui-editor-toolbar', className)}>
      <IconButton label={back.label} onClick={back.onBack}>
        <ChevronLeft size={20} aria-hidden />
      </IconButton>
      {status}
      {actions}
    </div>
  );
}
