'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { cx } from '../lib/cx';

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

export function FabMenu({ label, icon, children, open, onOpenChange, className }: FabMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  useFabMenuDismiss({ rootRef, open, onOpenChange });

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

interface FabMenuDismiss {
  rootRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Closes the panel on Escape or a pointerdown outside the menu. */
function useFabMenuDismiss({ rootRef, open, onOpenChange }: FabMenuDismiss) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current != null && !rootRef.current.contains(event.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [rootRef, open, onOpenChange]);
}
