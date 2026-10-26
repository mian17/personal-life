'use client';

import { useRef } from 'react';
import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import { usePanelDismiss } from '../lib/panel-dismiss';

export interface FabMenuProps {
  /** Trigger accessible name. */
  label: string;
  /** The trigger glyph. */
  icon: ReactNode;
  /** Panel content: the link options. */
  children: ReactNode;
  /** Controlled open state. */
  open: boolean;
  /** Called with the next state (trigger toggle, Escape, outside click). */
  onOpenChange: (open: boolean) => void;
  className?: string;
}

export function FabMenu({ label, icon, children, open, onOpenChange, className }: Readonly<FabMenuProps>) {
  const rootRef = useRef<HTMLDivElement>(null);
  usePanelDismiss({ rootRef, open, onOpenChange });

  return (
    <div ref={rootRef} className={cx('ui-fab-menu', className)}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="ui-fab-menu__trigger"
        onClick={() => onOpenChange(!open)}
      >
        {icon}
      </button>
      {open && (
        <div className="ui-fab-menu__panel" role="menu">
          {children}
        </div>
      )}
    </div>
  );
}

