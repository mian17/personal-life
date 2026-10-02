import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

/** One choice in a `Select`. `value` is the submitted string; `label` is shown. */
export interface SelectOption {
  value: string;
  label: string;
}

/**
 * The native `<select>` control, the single owner of `.ui-select`. The atom
 * renders the `<option>` elements from `options`, so consumers pass data, never
 * raw option markup — the same "no raw HTML in apps" rule the other controls
 * follow. Native over a custom popover: the platform gives the OS picker and the
 * combobox semantics for free. Single-select by construction.
 */
export interface SelectProps extends Omit<ComponentPropsWithRef<'select'>, 'children'> {
  options: SelectOption[];
}

export function Select({ options, className, ...rest }: SelectProps) {
  return (
    <select className={cx('ui-select', className)} {...rest}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
