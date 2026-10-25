'use client';

import { useRef } from 'react';
import type { ReactNode } from 'react';
import { MoreVertical } from 'lucide-react';
import { cx } from '../lib/cx';
import { usePanelDismiss } from '../lib/panel-dismiss';
import { IconButton } from './icon-button';

export interface MenuProps {
  /** Trigger accessible name. */
  label: string;
  /** The always-visible row content (the entity name). */
  summary: ReactNode;
  /** Panel content, revealed when open. */
  children: ReactNode;
  /** Controlled open state. */
  open: boolean;
  /** Called with the next state (trigger toggle, Escape, outside click). */
  onOpenChange: (open: boolean) => void;
  /** Disables the trigger. */
  disabled?: boolean;
  className?: string;
}

export function Menu({
  label,
  summary,
  children,
  open,
  onOpenChange,
  disabled,
  className,
}: Readonly<MenuProps>) {
  const rootRef = useRef<HTMLDivElement>(null);

  usePanelDismiss({ rootRef, open, onOpenChange });

  return (
    <div ref={rootRef} className={cx('ui-menu', className)}>
      <div className="ui-menu__summary">
        <span className="ui-menu__label">{summary}</span>
        <IconButton
          label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => onOpenChange(!open)}
        >
          <MoreVertical size={16} aria-hidden />
        </IconButton>
      </div>
      {open && (
        <div className="ui-menu__panel" role="menu">
          {children}
        </div>
      )}
    </div>
  );
}
