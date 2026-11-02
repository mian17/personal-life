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
 * FabLink's fixed bottom-right corner, drawn on the same two rules as `.fab` so the trigger
 * cannot drift from a plain FabLink on the same screen. The panel stacks above the trigger, so
 * the column runs in reverse: the trigger stays pinned to the corner while options grow upward.
 */
const cornerStyles = cx(
  'fixed z-30 flex flex-col-reverse items-end gap-[var(--s2)]',
  'right-[max(var(--s4),calc((100vw_-_var(--frame-max))/2_+_var(--s4)))]',
  'bottom-[calc(env(safe-area-inset-bottom)+var(--s4))]',
);

/**
 * FabLink's accent pill, as a button rather than a link. `outline-none` zeroes the style
 * variable an outline width draws with, so the focus ring needs its style back; width and
 * offset both ride the `--focus-ring` token.
 */
const triggerStyles = cx(
  'inline-flex items-center justify-center size-[var(--fab-size)] rounded-full cursor-pointer',
  'border border-max bg-max text-on-max active:bg-max-press',
  'outline-none motion-safe:transition-colors',
  'focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)]',
  'focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-max',
);

/**
 * The options panel: one raised surface, one line, one `--s2` inset — the same flat panel
 * every floating menu in the system draws, fading in over `--d-fast` on open.
 */
const panelStyles = cx(
  'flex flex-col gap-[var(--s1)] p-[var(--s2)]',
  'border border-line rounded-[var(--r-lg)] bg-surface',
  'motion-safe:transition-opacity starting:opacity-0',
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

