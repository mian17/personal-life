// shadcn/ui registry copy (`dialog`), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from '../lib/cx';
import { IconButton } from './icon-button';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** `full` renders an edge-to-edge full-screen sheet instead of the centred panel. */
  size?: 'default' | 'full';
  className?: string;
}

/**
 * The registry overlay and panel, theme-mapped: the scrim is the page colour at half strength,
 * so no colour literal enters our sheets, and the geometry rides the token spacing scale. Radix
 * portals the panel into the top layer, where an ancestor's `overflow: hidden` cannot clip it,
 * and owns the focus trap and Escape handling.
 */
const dialogOverlay = 'fixed inset-0 z-50 bg-bg/50';

const dialogPanel = cx(
  'fixed z-50 flex flex-col gap-[var(--space-1)]',
  'border border-border bg-panel p-[var(--space-1)] text-text',
  'shadow-[var(--shadow-fab)]',
);

const centredPanel = cx(
  'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
  'w-[calc(100%-var(--space-2))] max-w-[var(--content-width)]',
  'rounded-[var(--radius-lg)]',
);

/** Full-screen sheet: edge-to-edge and square-cornered, `100dvh` tracking the mobile viewport. */
const sheetPanel = 'inset-0 h-[100dvh] w-full rounded-none';

const dialogHeader = cx(
  'ui-dialog__head',
  'flex items-center justify-between gap-[var(--space-0-5)] mb-[var(--space-1)]',
);

const dialogTitle = cx('ui-dialog__title', 'm-0 text-[length:var(--space-1-25)] font-bold');

const dialogBody = cx('ui-dialog__body', 'flex flex-col gap-[var(--space-1)]');

const dialogFooter = cx(
  'ui-dialog__footer',
  'flex justify-end gap-[var(--space-0-5)] mt-[var(--space-1)]',
);

/** The element holding focus right now, or nothing when focus sits nowhere focusable. */
function focusedElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  footer,
  size = 'default',
  className,
}: Readonly<DialogProps>) {
  // Radix would hand focus back to its own trigger, which a controlled surface never renders, so
  // the opener is remembered as the panel takes focus and handed back once it has closed.
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) openerRef.current?.focus();
  }, [open]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-slot="dialog-overlay" className={dialogOverlay} />
        <DialogPrimitive.Content
          data-slot="dialog-content"
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            openerRef.current = focusedElement();
          }}
          className={cx(
            'ui-dialog',
            size === 'full' && 'ui-dialog--full',
            dialogPanel,
            size === 'full' ? sheetPanel : centredPanel,
            className,
          )}
        >
          <div className={dialogHeader}>
            <DialogPrimitive.Title className={dialogTitle}>{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <IconButton label="Close">
                <X size={20} aria-hidden />
              </IconButton>
            </DialogPrimitive.Close>
          </div>
          <div className={dialogBody}>{children}</div>
          {footer != null && <div className={dialogFooter}>{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
