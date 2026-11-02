// shadcn/ui registry copy (`command`), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
'use client';

import { Command as CommandPrimitive } from 'cmdk';
import type { ComponentProps } from 'react';
import { cx } from '../lib/cx';

/**
 * The registry `command` parts, §8 flat: the panel fill, line and radius belong to the popover
 * content that holds this list, and the selected row is the app's accent pair. Geometry rides the
 * token spacing scale.
 *
 * `cmdk` owns the listbox, the selected row `aria-activedescendant` names, the keyboard walk and
 * the auto-highlight of the first row; a caller that filters its own rows passes
 * `shouldFilter={false}`. The auto-highlight obeys the root's `value`: a caller that wants a list
 * to open unchosen holds that value at something no row carries.
 *
 * Deviation from the registry root: its panel fill, rounding and clipping are dropped. In the
 * combobox recipe the root wraps the *field* as well as the list, and the panel around the list
 * is the popover content, which already carries fill, border and radius.
 *
 * Subset of the registry item: `CommandDialog`, `CommandGroup`, `CommandSeparator`,
 * `CommandShortcut` and `CommandInput` have no consumer here, so they are not vendored.
 */
const commandStyles = 'flex w-full flex-col';

/**
 * Registry `max-h-[300px]`: the list is as tall as the caller's `--autosuggest-rows` — one tap
 * target and the gap under it each — then it scrolls.
 */
const listStyles = cx(
  'overflow-x-hidden overflow-y-auto scroll-py-[var(--s1)]',
  'p-[var(--s1)]',
  'max-h-[calc(var(--autosuggest-rows,8)*(var(--tap)+var(--s1)))]',
);

/** The no-match line sits at the list's own inset, in the second ink tier. */
const emptyStyles = cx(
  'py-[var(--s4)] text-center text-ink-2 text-[length:var(--fs-label)]',
);

/** One row: a tap target tall, accent fill while `cmdk` marks it selected. */
const itemStyles = cx(
  'relative flex min-h-[var(--tap)] cursor-default select-none items-center',
  'gap-[var(--s2)] px-[var(--s3)] py-[var(--s2)]',
  'rounded-[var(--r-sm)] text-ink outline-none',
  'data-[selected=true]:bg-max data-[selected=true]:text-on-max',
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
