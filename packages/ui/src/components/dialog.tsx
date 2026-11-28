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
  /** Action at the header's start; its presence switches the header to the three-column line. */
  leadingAction?: ReactNode;
  /** Action at the header's end — replaces the drawn close control when given. */
  trailingAction?: ReactNode;
  /** `false` drops the grab handle and the close control: the confirm shape. Default `true`. */
  dismiss?: boolean;
  /**
   * `false` draws no grab handle on a dismissible sheet, and changes nothing else: the header keeps
   * its title, its actions, its inset and its close control. The design's meditation sheet has no
   * handle. Default `true`.
   */
  grab?: boolean;
  /**
   * Where the title sits in its header row: `start` for every shipped dialog, or `center` for the
   * design's confirm, whose title is centred over the full-width column beneath it. The copy under
   * the title stays at the start edge either way. Default `'start'`.
   */
  titleAlign?: 'start' | 'center';
  /** The body's own rhythm; the design's sheet spaces its groups one step wider. */
  bodyGap?: 's4' | 's5';
  /**
   * A shared sheet's inset, which is the app's: `--s2` above the title and `--s4` at the sides.
   * `design` gives a surface its own design's inset instead — the design's meditation sheet draws
   * `--s2` inline and `--s4` in the body, with no inset above its header. Applies to a dismissible
   * sheet only: the confirm shape insets its own panel. Default `'app'`.
   */
  sheetInset?: 'app' | 'design';
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

/**
 * Every dialog size shares the overlay, so only the sheet's carries the scrim's exit — the same
 * fade, backwards, styled in `base.css` under the motion gate.
 */
const sheetScrimExit = 'ui-dialog__scrim--sheet';

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
 * A sheet gives its padding to the slots, so a slot's rule can reach the panel's edges — a header
 * hairline cannot be inset on each side and still read as a sheet. Only the safe area stays on the
 * panel, because nothing inside it knows where the home indicator is.
 */
const sheetPanelPadding = 'px-0 pt-0 pb-[env(safe-area-inset-bottom)]';

/** The confirm shape has no header row to inset, so the panel keeps the confirm's own inset. */
const confirmPanelPadding =
  'px-[var(--s5)] pt-[var(--s6)] pb-[calc(var(--s8)+env(safe-area-inset-bottom))]';

/**
 * §8's `.sheet`: pinned to the frame's bottom edge, one card radius on its top corners, as tall as
 * the viewport allows less one `--s8`+`--s2` rail, and clear of the home indicator. It arrives by
 * travelling its own height, which is the one transition in the system that runs `--d-base`.
 *
 * The starting style repeats the open state's attribute so it outranks the `data-[state=open]`
 * reset: a bare `starting:translate-y-full` compiles to one class (0,1,0) and loses to
 * `.data-[state=open]:translate-y-0[data-state="open"]` (0,2,0), which leaves the panel already
 * at its final position on the first frame — no travel, no transition.
 *
 * The entrance is a transition; the exit cannot be, and lives in `base.css` as a keyframe — see
 * the comment there.
 */
function sheetPanelStyles(dismiss: boolean): string {
  return cx(
    'ui-dialog--sheet',
    'left-1/2 bottom-0 -translate-x-1/2 translate-y-full data-[state=open]:translate-y-0',
    'w-full max-w-[var(--frame-max)] max-h-[calc(100dvh-(var(--s8)+var(--s2)))] overflow-y-auto',
    'rounded-t-[var(--r-lg)] border-t',
    dismiss ? sheetPanelPadding : confirmPanelPadding,
    'motion-safe:transition-transform starting:data-[state=open]:translate-y-full',
  );
}

/**
 * §8's `.sheet__grab`: the one affordance that says the panel can be dragged away. It is a
 * decoration on the panel's top edge, not a row of its own, so it costs the sheet no height: the
 * header behind it starts where the design's header starts, at the panel's own edge.
 */
const grabStyles = cx(
  'ui-dialog__grab',
  'absolute top-0 left-1/2 -translate-x-1/2',
  'w-[calc(var(--s8)+var(--s1))] h-[var(--s1)]',
  'rounded-[var(--r-pill)] bg-line-strong',
);

const dialogHeader = 'ui-dialog__head';

/**
 * A centred or full panel insets its header from the panel's own `--s4`; a sheet gives the inset to
 * the slots, so its own geometry lives in `sheetHeaderStyles`.
 */
const panelHeaderInset = 'mt-[var(--s2)]';

/** Two parts: the title block, then the close control. */
const splitHeaderStyles = cx(dialogHeader, 'flex items-start justify-between gap-[var(--s2)]');

/** Three columns, so a leading and a trailing action both sit on the title's line. */
const actionHeaderStyles = cx(
  dialogHeader,
  'grid grid-cols-[1fr_auto_1fr] items-center gap-[var(--s2)]',
);

/**
 * The sheet's own header inset and hairline. The hairline is a `border-b` on a full-width header
 * with no inline padding on the panel, so it reaches both edges in either mode.
 */
const sheetHeaderStyles: Record<NonNullable<DialogProps['sheetInset']>, string> = {
  app: 'pt-[var(--s2)] px-[var(--s4)] border-b border-line',
  design: 'px-[var(--s2)] border-b border-line',
};

const dialogTitle = cx(
  'ui-dialog__title',
  'm-0 text-[length:var(--fs-sheet-title)] leading-[var(--lh-sheet-title)]',
  'tracking-[var(--tracking-sheet-title)] [font-weight:var(--fw-semibold)]',
);

const dialogTitleBlock = cx('ui-dialog__title-block', 'flex flex-col');

/**
 * The title's own line, never the block's: a centred title centres its words, while the copy
 * underneath keeps the column's start edge — which is where the design draws it.
 */
const titleAlignStyles: Record<NonNullable<DialogProps['titleAlign']>, string | undefined> = {
  start: undefined,
  center: 'text-center',
};

/**
 * Centring needs the row's width. The two-part header is a flex line with the title at its start,
 * so a centred title grows into the free space and leaves the trailing control on its edge. The
 * three-column header already centres its middle cell, where growing the block adds nothing.
 */
const centredTitleBlockStyles = 'flex-1';

/** §8's `.sheet__sub`: one `--s4` under the title, `14px` (`--fs-label`), the second ink tier. */
const dialogDescription = cx(
  'ui-dialog__sub',
  'm-0 mt-[var(--s4)] text-[length:var(--fs-label)] text-ink-2',
);

const dialogBody = 'ui-dialog__body flex flex-col mt-[var(--s4)]';

/**
 * The sheet's body and footer insets. Only a dismissible sheet gives its padding to the slots: the
 * confirm shape keeps its own panel inset, and a slot that repeated it would inset the content
 * twice. The body's top inset is `dialogBody`'s own `--s4` `mt`, which both sheet designs sit on.
 */
const sheetBodyStyles = 'px-[var(--s4)] pb-[var(--s8)]';

/** The body's own rhythm, one step per request; `s4` is the shipped spacing. */
const bodyGapStyles: Record<NonNullable<DialogProps['bodyGap']>, string> = {
  s4: 'gap-[var(--s4)]',
  s5: 'gap-[var(--s5)]',
};

const dialogFooter = cx(
  'ui-dialog__footer',
  'flex flex-wrap justify-end gap-[var(--s2)] mt-[var(--s6)]',
);

/** The sheet's footer inset, for the same reason the body draws one. */
const sheetFooterStyles = 'px-[var(--s4)]';

/** The geometry the two fixed sizes draw; the sheet's depends on whether it can be dismissed. */
const panelStyles: Record<Exclude<NonNullable<DialogProps['size']>, 'sheet'>, string> = {
  default: centredPanel,
  full: fullPanel,
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
  leadingAction,
  trailingAction,
  dismiss = true,
  grab = true,
  titleAlign = 'start',
  bodyGap = 's4',
  sheetInset = 'app',
  className,
}: Readonly<DialogProps>) {
  // Radix would hand focus back to its own trigger, which a controlled surface never renders, so
  // the opener is remembered as the panel takes focus and handed back once it has closed.
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) openerRef.current?.focus();
  }, [open]);

  // A sheet that can be dismissed gives its padding to the slots and draws the grab; the confirm
  // shape keeps the panel's own inset, so a slot must not repeat it.
  const dismissibleSheet = size === 'sheet' && dismiss;
  // The handle is a decoration on that sheet's top edge, so dropping it moves nothing else.
  const showGrab = dismissibleSheet && grab;
  const centredTitle = titleAlign === 'center';
  // A sheet's header opens on the panel's edge; the centred and full panels inset their own.
  const headerInsetStyles = size === 'sheet' ? undefined : panelHeaderInset;
  const headerSlotStyles = dismissibleSheet ? sheetHeaderStyles[sheetInset] : headerInsetStyles;
  // A dismissed surface has no header row for a trailing action to sit in, so that prop loses to
  // it; the title and its copy still render, because the title is what names the dialog.
  const trailing = dismiss
    ? (trailingAction ?? (
        <DialogPrimitive.Close asChild>
          <IconButton label="Close">
            <X size={20} aria-hidden />
          </IconButton>
        </DialogPrimitive.Close>
      ))
    : undefined;
  const hasActionRow = leadingAction != null || (dismiss && trailingAction != null);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-slot="dialog-overlay"
          className={cx(dialogOverlay, size === 'sheet' && sheetScrimExit)}
        />
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
            size === 'sheet' ? sheetPanelStyles(dismiss) : panelStyles[size],
            className,
          )}
        >
          {showGrab && <div aria-hidden className={grabStyles} />}
          <div
            className={cx(hasActionRow ? actionHeaderStyles : splitHeaderStyles, headerSlotStyles)}
          >
            {leadingAction != null && <div className="ui-dialog__leading">{leadingAction}</div>}
            <div className={cx(dialogTitleBlock, centredTitle && centredTitleBlockStyles)}>
              <DialogPrimitive.Title className={cx(dialogTitle, titleAlignStyles[titleAlign])}>
                {title}
              </DialogPrimitive.Title>
              {description != null && <p className={dialogDescription}>{description}</p>}
            </div>
            {trailing}
          </div>
          <div
            className={cx(dialogBody, bodyGapStyles[bodyGap], dismissibleSheet && sheetBodyStyles)}
          >
            {children}
          </div>
          {footer != null && (
            <div className={cx(dialogFooter, dismissibleSheet && sheetFooterStyles)}>{footer}</div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
