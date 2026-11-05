// shadcn/ui registry copy (`popover`), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import type { ComponentProps } from 'react';
import { cx } from '../lib/cx';

/**
 * The registry `popover` parts, theme-mapped: `bg-popover` is the raised surface, `rounded-md` is
 * `--r-lg` — a floating panel is a card-sized surface, so it takes the card's radius and line,
 * not the control radius — and the registry's `shadow-md` is gone, because §6 retired the product
 * shadow. Radix portals the panel into the top layer, where an ancestor's `overflow: hidden`
 * cannot clip it, and owns the outside-press and Escape dismissal. It fades in over `--d-fast`.
 *
 * The registry's fixed `w-72` and `p-4` are left to the caller: a panel that hangs off a control
 * is as wide as that control, and a command panel brings its own row padding.
 *
 * Subset of the registry item: `PopoverTrigger` and `PopoverClose` have no consumer here (the
 * field is a `PopoverAnchor`, and every dismissal is the caller's decision), so they are not
 * vendored.
 */
const contentStyles = cx(
  'z-50 overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface text-ink',
  'outline-none motion-safe:transition-opacity starting:opacity-0',
);

export function Popover(props: Readonly<ComponentProps<typeof PopoverPrimitive.Root>>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

export function PopoverAnchor(props: Readonly<ComponentProps<typeof PopoverPrimitive.Anchor>>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

export function PopoverContent({
  className,
  align = 'start',
  sideOffset = 4,
  ...rest
}: Readonly<ComponentProps<typeof PopoverPrimitive.Content>>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cx(contentStyles, className)}
        {...rest}
      />
    </PopoverPrimitive.Portal>
  );
}
