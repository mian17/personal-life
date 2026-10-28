// shadcn/ui registry copy (`dropdown-menu`), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
'use client';

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { MoreVertical } from 'lucide-react';
import { cx } from '../lib/cx';
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

/** The row: summary and its `⋯` trigger, always in flow beside the entity name. */
const rowStyles = 'relative flex flex-col gap-[var(--space-0-4)]';

const summaryStyles = 'flex items-center gap-[var(--space-0-5)]';

const labelStyles = 'min-w-0 flex-1 truncate';

/**
 * Registry panel, theme-mapped: fill and border ride the existing tokens, so the open menu
 * introduces no colour of its own. Radix portals it into the top layer, where the managers'
 * `overflow: hidden` card cannot clip it, and owns the focus trap, Escape and outside dismiss.
 */
const panelStyles = cx(
  'z-50 flex flex-col gap-[var(--space-0-4)]',
  'p-[var(--space-0-5)] border rounded-[var(--radius-md)]',
  'bg-panel text-text shadow-[var(--shadow-fab)]',
);

export function Menu({
  label,
  summary,
  children,
  open,
  onOpenChange,
  disabled,
  className,
}: Readonly<MenuProps>) {
  return (
    // Non-modal: the per-row disclosure leaves the page behind it interactive, as the
    // hand-rolled panel it replaces did, while Radix keeps the dismiss behaviour.
    <DropdownMenuPrimitive.Root modal={false} open={open} onOpenChange={onOpenChange}>
      <div className={cx('ui-menu', rowStyles, className)}>
        <div className={cx('ui-menu__summary', summaryStyles)}>
          <span className={cx('ui-menu__label', labelStyles)}>{summary}</span>
          <DropdownMenuPrimitive.Trigger asChild disabled={disabled}>
            <IconButton label={label}>
              <MoreVertical size={16} aria-hidden />
            </IconButton>
          </DropdownMenuPrimitive.Trigger>
        </div>
        <DropdownMenuPrimitive.Portal>
          <DropdownMenuPrimitive.Content className={cx('ui-menu__panel', panelStyles)}>
            {children}
          </DropdownMenuPrimitive.Content>
        </DropdownMenuPrimitive.Portal>
      </div>
    </DropdownMenuPrimitive.Root>
  );
}
