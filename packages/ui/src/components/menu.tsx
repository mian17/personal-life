// shadcn/ui registry copy (`dropdown-menu`), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
'use client';

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { MoreVertical } from 'lucide-react';
import { cx } from '../lib/cx';
import { IconButton, type IconButtonVariant } from './icon-button';

export interface MenuProps {
  /** Trigger accessible name. */
  label: string;
  /** The always-visible row content (the entity name). Omitted renders the trigger alone. */
  summary?: ReactNode;
  /** Panel content, revealed when open. */
  children: ReactNode;
  /** Controlled open state. */
  open: boolean;
  /** Called with the next state (trigger toggle, Escape, outside click). */
  onOpenChange: (open: boolean) => void;
  /** Disables the trigger. */
  disabled?: boolean;
  /** The trigger's face; omitted, the trigger stays the borderless `.iconbtn`. */
  triggerVariant?: IconButtonVariant;
  /** The trigger's shape, so a header's overflow control matches the app's action language. */
  triggerShape?: 'rounded' | 'pill';
  /** The trigger's glyph; omitted, the vertical ellipsis every row uses. */
  triggerIcon?: ReactNode;
  /** The gap between the trigger and the panel. */
  sideOffset?: number;
  /** `default` is the raised panel; `compact` is one step tighter — the design's secondary surface. */
  density?: 'default' | 'compact';
  className?: string;
}

/** The row: summary and its `⋯` trigger, always in flow beside the entity name. */
const rowStyles = 'relative flex flex-col gap-[var(--s2)]';

const summaryStyles = 'flex items-center gap-[var(--s2)]';

const labelStyles = 'min-w-0 flex-1 truncate';

/**
 * The panel is one raised surface: surface fill, one line, no shadow — `--r-lg` and an `--s2` inset
 * by default, `--r-md` and an `--s1` inset for the design's tighter secondary surface. Radix portals
 * it into the top layer, where the managers' `overflow: hidden` card cannot clip it, and owns the
 * focus trap, Escape and outside dismiss. It fades in over `--d-fast`.
 */
const panelStyles: Record<NonNullable<MenuProps['density']>, string> = {
  default: cx(
    'z-50 flex flex-col gap-[var(--s1)]',
    'p-[var(--s2)] border border-line rounded-[var(--r-lg)]',
    'bg-surface text-ink',
    'motion-safe:transition-opacity starting:opacity-0',
  ),
  compact: cx(
    'z-50 flex flex-col gap-[var(--s1)]',
    'p-[var(--s1)] border border-line rounded-[var(--r-md)]',
    'bg-surface text-ink',
    'motion-safe:transition-opacity starting:opacity-0',
  ),
};

/**
 * The gap between the trigger and the panel: the raised surface sits one step off its trigger
 * rather than touching it, and `--s2` is that step. Radix's `sideOffset` is a popper offset in px,
 * not a style, so it cannot take `var(--s2)` — the literal mirrors the token, as `popover.tsx`'s
 * own default does for the same reason.
 */
const PANEL_SIDE_OFFSET_PX = 8;

/** One entry of the panel: whatever draws the row, plus the panel's own hook class. */
export interface MenuItemProps {
  children: ReactNode;
  /** `row` paints the tap-height menu row; `bare` leaves the child to draw itself, as today. */
  size?: 'bare' | 'row';
  className?: string;
}

/**
 * §8's `.menu__item`: one tap-height row, inset one step, washing to `--press` under the finger.
 * Selected, never added to a face the caller already drew — `row` is the mode for an entry whose
 * child carries no box of its own.
 */
const itemRowStyles = cx(
  'block w-full min-h-[var(--tap)] px-[var(--s4)] py-0 rounded-[var(--r-sm)]',
  'text-start text-[length:var(--fs-button)] motion-safe:transition-colors active:bg-press',
);

/**
 * One entry of the panel. Radix's `Item` is what makes it a menu item — `role="menuitem"` and
 * Arrow-key movement between entries — which a plain button dropped into the panel never gets.
 * `asChild` keeps the primitive's own look; only the role and the keys are added.
 */
export function MenuItem({ children, size = 'bare', className }: Readonly<MenuItemProps>) {
  return (
    <DropdownMenuPrimitive.Item
      asChild
      className={cx('ui-menu__item', size === 'row' && itemRowStyles, className)}
    >
      {children}
    </DropdownMenuPrimitive.Item>
  );
}

export function Menu({
  label,
  summary,
  children,
  open,
  onOpenChange,
  disabled,
  triggerVariant = 'default',
  triggerShape = 'rounded',
  triggerIcon = <MoreVertical size={16} aria-hidden />,
  sideOffset = PANEL_SIDE_OFFSET_PX,
  density = 'default',
  className,
}: Readonly<MenuProps>) {
  const trigger = (
    <DropdownMenuPrimitive.Trigger asChild disabled={disabled}>
      <IconButton label={label} variant={triggerVariant} shape={triggerShape}>
        {triggerIcon}
      </IconButton>
    </DropdownMenuPrimitive.Trigger>
  );

  return (
    // Non-modal: the per-row disclosure leaves the page behind it interactive, as the
    // hand-rolled panel it replaces did, while Radix keeps the dismiss behaviour.
    <DropdownMenuPrimitive.Root modal={false} open={open} onOpenChange={onOpenChange}>
      <div className={cx('ui-menu', rowStyles, className)}>
        {summary == null ? (
          trigger
        ) : (
          <div className={cx('ui-menu__summary', summaryStyles)}>
            <span className={cx('ui-menu__label', labelStyles)}>{summary}</span>
            {trigger}
          </div>
        )}
        <DropdownMenuPrimitive.Portal>
          <DropdownMenuPrimitive.Content
            sideOffset={sideOffset}
            className={cx('ui-menu__panel', panelStyles[density])}
          >
            {children}
          </DropdownMenuPrimitive.Content>
        </DropdownMenuPrimitive.Portal>
      </div>
    </DropdownMenuPrimitive.Root>
  );
}
