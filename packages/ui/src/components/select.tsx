// shadcn/ui registry copy (`native-select`), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

/** One choice in a `Select`. `value` is the submitted string; `label` is shown. */
export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<ComponentPropsWithRef<'select'>, 'children'> {
  options: SelectOption[];
}

/**
 * Registry `native-select` class string, theme-mapped the way `input` is: `border-input`
 * → `--border`, `text-foreground` → `--text`, `bg-transparent` → `bg-panel` so the picker
 * reads as the field shell standing beside `Input`. Registry's `h-9` becomes the repo's
 * 48px `h-12`, and `[font:inherit]` stands in for the preflight this repo never loads.
 *
 * Native over a Radix `select`: the platform picker brings OS `<option>` mapping and
 * combobox semantics for free, and single select needs no portal to get them.
 */
const selectStyles = cx(
  'block w-full min-w-0 h-12 rounded-md border border-border bg-panel px-3 py-2',
  'text-base text-text [font:inherit] outline-none motion-safe:transition-colors',
  'cursor-pointer [-webkit-tap-highlight-color:transparent]',
  'focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)] focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-accent',
  'disabled:cursor-not-allowed disabled:text-muted',
);

export function Select({ options, className, ...rest }: Readonly<SelectProps>) {
  return (
    <select data-slot="select" className={cx('ui-select', selectStyles, className)} {...rest}>
      {options.map(renderOption)}
    </select>
  );
}

function renderOption({ value, label }: SelectOption) {
  return (
    <option key={value} value={value}>
      {label}
    </option>
  );
}
