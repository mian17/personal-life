// shadcn/ui registry copy (`command`), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
'use client';

import { Command as CommandPrimitive } from 'cmdk';
import type { ComponentProps } from 'react';
import { cx } from '../lib/cx';

/**
 * The registry `command` parts, theme-mapped: `bg-popover` is `--panel`, `text-popover-foreground`
 * is `--text`, `bg-accent`/`text-accent-foreground` are `--accent`/`--on-accent`, `border` is
 * `--border` and `text-muted-foreground` is `--muted`. Geometry rides the token spacing scale.
 *
 * `cmdk` owns the listbox, the selected row `aria-activedescendant` names, the keyboard walk and
 * the auto-highlight of the first row; a caller that filters its own rows passes
 * `shouldFilter={false}`. The auto-highlight obeys the root's `value`: a caller that wants a list
 * to open unchosen holds that value at something no row carries.
 *
 * Deviation from the registry root: its panel fill, rounding and clipping are dropped. In the
 * combobox recipe the root wraps the *field* as well as the list, and the panel around the list
 * is the popover content, which already carries fill, border and shadow.
 *
 * Subset of the registry item: `CommandDialog`, `CommandGroup`, `CommandSeparator`,
 * `CommandShortcut` and `CommandInput` have no consumer here, so they are not vendored.
 */
const commandStyles = 'flex w-full flex-col';

/**
 * Registry `max-h-[300px]`: the list is as tall as the caller's `--autosuggest-rows` — one tap
 * target and the gap under it each, less the trailing gap, plus the list's own padding — then it
 * scrolls.
 */
const listStyles = cx(
  'overflow-x-hidden overflow-y-auto scroll-py-[var(--space-0-25)]',
  'p-[var(--space-0-4)]',
  'max-h-[calc(var(--autosuggest-rows,8)*(var(--tap-height)+var(--space-0-25)))]',
);

const emptyStyles = 'py-[var(--space-1)] text-center text-muted';

const itemStyles = cx(
  'relative flex cursor-default select-none items-center gap-[var(--space-0-5)]',
  'px-[var(--space-0-5)] py-[var(--space-0-3)] text-text outline-none',
  'data-[selected=true]:bg-accent data-[selected=true]:text-on-accent',
  'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
);

export function Command({ className, ...rest }: Readonly<ComponentProps<typeof CommandPrimitive>>) {
  return <CommandPrimitive data-slot="command" className={cx(commandStyles, className)} {...rest} />;
}

export function CommandList({
  className,
  ...rest
}: Readonly<ComponentProps<typeof CommandPrimitive.List>>) {
  return <CommandPrimitive.List data-slot="command-list" className={cx(listStyles, className)} {...rest} />;
}

export function CommandEmpty({
  className,
  ...rest
}: Readonly<ComponentProps<typeof CommandPrimitive.Empty>>) {
  return <CommandPrimitive.Empty data-slot="command-empty" className={cx(emptyStyles, className)} {...rest} />;
}

export function CommandItem({
  className,
  ...rest
}: Readonly<ComponentProps<typeof CommandPrimitive.Item>>) {
  return <CommandPrimitive.Item data-slot="command-item" className={cx(itemStyles, className)} {...rest} />;
}
