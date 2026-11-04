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
  /** Second line under the title, inside the header's left block. Omitted renders no line. */
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** `full` is an edge-to-edge screen; `sheet` is the bottom sheet, its top edge a card radius. */
  size?: 'default' | 'full' | 'sheet';
  className?: string;
}

/**
 * The registry overlay and panel, §8's flat surfaces: no product shadow, one line, one radius per
 * shape. Radix portals the panel into the top layer, where an ancestor's `overflow: hidden` cannot
 * clip it, and owns the focus trap and Escape handling.
 *
 * The scrim dims the page through `--scrim`, and fades in over `--d-fast`; the sheet below it
 * travels up over `--d-base`. Both are `motion-safe:`, so `reduce` collapses them and the surface
 * simply appears.
 */
const dialogOverlay = cx(
  'fixed inset-0 z-40 bg-[var(--scrim)]',
  'motion-safe:transition-opacity starting:opacity-0',
);

const dialogPanel = cx('fixed z-50 flex flex-col text-ink', 'border border-line bg-surface');

/** The centred panel: a card, `--s4` inset, `--r-lg`, narrower than the frame it floats on. */
const centredPanel = cx(
  'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
  'w-[calc(100%-var(--s8))] max-w-[var(--frame-max)]',
  'p-[var(--s4)] rounded-[var(--r-lg)]',
);

/** Full screen: edge-to-edge and square-cornered, `100dvh` tracking the mobile viewport. */
const fullPanel = 'inset-0 h-[100dvh] w-full rounded-none p-[var(--s4)]';

/**
 * §8's `.sheet`: pinned to the frame's bottom edge, one card radius on its top corners, as tall as
 * the viewport allows less one `--s8`+`--s2` rail, and clear of the home indicator. It arrives by
 * travelling its own height, which is the one transition in the system that runs `--d-base`.
 */
const sheetPanel = cx(
  'ui-dialog--sheet',
  'left-1/2 bottom-0 -translate-x-1/2 translate-y-full data-[state=open]:translate-y-0',
  'w-full max-w-[var(--frame-max)] max-h-[calc(100dvh-(var(--s8)+var(--s2)))] overflow-y-auto',
  'rounded-t-[var(--r-lg)] border-t',
  'p-[var(--s2)_var(--s4)_calc(var(--s6)+env(safe-area-inset-bottom))]',
  'motion-safe:transition-transform starting:translate-y-full',
);

/** §8's `.sheet__grab`: the one affordance that says the panel can be dragged away. */
const grabStyles = cx(
  'ui-dialog__grab',
  'w-[calc(var(--s8)+var(--s1))] h-[var(--s1)] mt-[var(--s2)] mx-auto mb-0',
  'rounded-[var(--r-pill)] bg-line-strong',
);

const dialogHeader = cx(
  'ui-dialog__head',
  'flex items-start justify-between gap-[var(--s2)] mt-[var(--s2)]',
);

const dialogTitle = cx(
  'ui-dialog__title',
  'm-0 text-[length:var(--fs-sheet-title)] leading-[var(--lh-sheet-title)]',
  'tracking-[var(--tracking-sheet-title)] font-bold',
);

const dialogTitleBlock = cx('ui-dialog__title-block', 'flex flex-col');

/** §8's `.sheet__sub`: one `--s1` under the title, `14px` (`--fs-label`), the second ink tier. */
const dialogDescription = cx(
  'ui-dialog__sub',
  'm-0 mt-[var(--s1)] text-[length:var(--fs-label)] text-ink-2',
);

const dialogBody = cx('ui-dialog__body', 'flex flex-col gap-[var(--s4)] mt-[var(--s4)]');

const dialogFooter = cx(
  'ui-dialog__footer',
  'flex flex-wrap justify-end gap-[var(--s2)] mt-[var(--s6)]',
);

/** The geometry each size draws: the centred card, the full screen, or the bottom sheet. */
const panelStyles: Record<NonNullable<DialogProps['size']>, string> = {
  default: centredPanel,
  full: fullPanel,
  sheet: sheetPanel,
};

/** The element holding focus right now, or nothing when focus sits nowhere focusable. */
function focusedElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
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
            panelStyles[size],
            className,
          )}
        >
          {size === 'sheet' && <div aria-hidden className={grabStyles} />}
          <div className={dialogHeader}>
            <div className={dialogTitleBlock}>
              <DialogPrimitive.Title className={dialogTitle}>{title}</DialogPrimitive.Title>
              {description != null && <p className={dialogDescription}>{description}</p>}
            </div>
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
