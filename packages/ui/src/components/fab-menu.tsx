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

/**
 * FabLink's fixed bottom-right corner. The panel stacks above the trigger, so the
 * column runs in reverse: the trigger stays pinned to the corner while options
 * grow upward from it.
 */
const cornerStyles = cx(
  'fixed z-10 flex flex-col-reverse items-end gap-[var(--space-0-5)]',
  'right-[calc(var(--space-1)+env(safe-area-inset-right))]',
  'bottom-[calc(var(--space-1)+env(safe-area-inset-bottom))]',
);

/**
 * FabLink's accent pill, as a button rather than a link. `outline-none` zeroes the
 * style variable an outline width draws with, so the focus ring needs its style back;
 * width and offset both ride the `--focus-ring` token.
 */
const triggerStyles = cx(
  'inline-flex items-center justify-center size-[var(--fab-size)] rounded-full cursor-pointer',
  'border-0 bg-accent text-on-accent shadow-[var(--shadow-fab)]',
  'outline-none motion-safe:transition-colors',
  'focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)]',
  'focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-accent',
);

/** The options panel: a raised surface holding the links the app supplies. */
const panelStyles = cx(
  'flex flex-col gap-[var(--space-0-4)] p-[var(--space-0-5)]',
  'border border-border rounded-[var(--radius-md)] bg-panel shadow-[var(--shadow-fab)]',
);

export function FabMenu({ label, icon, children, open, onOpenChange, className }: Readonly<FabMenuProps>) {
  const rootRef = useRef<HTMLDivElement>(null);
  usePanelDismiss({ rootRef, open, onOpenChange });

  return (
    <div ref={rootRef} className={cx('ui-fab-menu', cornerStyles, className)}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cx('ui-fab-menu__trigger', triggerStyles)}
        onClick={() => onOpenChange(!open)}
      >
        {icon}
      </button>
      {open && (
        <div className={cx('ui-fab-menu__panel', panelStyles)} role="menu">
          {children}
        </div>
      )}
    </div>
  );
}

