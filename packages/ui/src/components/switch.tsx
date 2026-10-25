'use client';

import { cx } from '../lib/cx';

export interface SwitchProps {
  /** Current state; controlled. The atom never stores it. */
  checked: boolean;
  /** Called with the next value on activation; omit to render a read-only switch. */
  onCheckedChange?: (next: boolean) => void;
  /** Accessible name (`aria-label`); frozen text supplied by the app. */
  label: string;
  /** Disables the control (no callback fires). */
  disabled?: boolean;
  /** Optional field name, passed through as the button's `name`. */
  name?: string;
  /** Class passthrough (e2e hooks ride on it). */
  className?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
  name,
  className,
}: Readonly<SwitchProps>) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      name={name}
      disabled={disabled}
      className={cx('ui-switch', checked && 'ui-switch--on', className)}
      onClick={() => onCheckedChange?.(!checked)}
    />
  );
}
