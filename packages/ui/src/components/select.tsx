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
 * The revised `.select` (REVISED-DESIGN §8): the 48px field shell beside `Input`, its value
 * set at 15px / 600 so a chosen option reads as a choice rather than as body copy.
 *
 * Native over a Radix `select`: the platform picker brings OS `<option>` mapping and
 * combobox semantics for free, and single select needs no portal to get them.
 */
const selectStyles = cx(
  'block w-full min-w-0 h-[var(--tap)] px-[var(--s3)]',
  'rounded-[var(--r-md)] border border-line-strong bg-surface',
  'text-[length:var(--fs-chip)] font-semibold text-ink [font:inherit] outline-none',
  'cursor-pointer [-webkit-tap-highlight-color:transparent] motion-safe:transition-colors',
  'focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)] focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-focus',
  'disabled:cursor-not-allowed disabled:text-ink-3',
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
