import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export interface CheckboxProps extends Omit<ComponentPropsWithRef<'span'>, 'children'> {
  /** Filled + check shown. Off by default (an empty square). */
  checked?: boolean;
}

/**
 * The done-toggle glyph: a rounded square that fills with the row's text colour
 * (`currentColor`) and reveals a check when `checked`. Presentational only — the
 * interactive control is the consumer's `IconButton`, so the tint (row tone /
 * muted done state) rides on the button's colour. The check is cut out in
 * `--panel` so it reads against the filled square.
 */
export function Checkbox({ checked = false, className, ...rest }: CheckboxProps) {
  return (
    <span
      aria-hidden
      className={cx('ui-checkbox', checked && 'ui-checkbox--checked', className)}
      {...rest}
    >
      <svg className="ui-checkbox__glyph" viewBox="0 0 24 24" focusable="false">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  );
}
