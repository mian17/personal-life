import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface FieldProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** Visible caption, rendered as the `.field__label` micro-caps line. */
  label: string;
  /** The control's id, so the caption is a real `<label for>` and not only a caption. */
  htmlFor?: string;
  /** The control the caption names. */
  children: ReactNode;
}

/**
 * §8's `.field`: label over control, one `--s2` apart. The gap between blocks belongs to the
 * stack that holds them, so a field never doubles the rhythm with a margin of its own.
 */
const fieldStyles = 'ui-field flex flex-col gap-[var(--s2)]';

/**
 * §8's `.field__label`: the section-label tier, upper case, second ink. Same hooks as the
 * feedback sheet's private copy, so both surfaces style a caption identically.
 */
const labelStyles = cx(
  'ui-field-label ui-field-label--strong',
  'shrink-0 uppercase text-ink-2',
  'text-[length:var(--fs-section-label)] font-[var(--fw-section-label)]',
  'tracking-[var(--tracking-section-label)]',
);

/**
 * A labelled control: a caption line and the control beneath it. Structural only — it holds no
 * state, draws no shell, and leaves the control's own accessible name alone.
 */
export function Field({ label, htmlFor, className, children, ...rest }: Readonly<FieldProps>) {
  return (
    <div className={cx(fieldStyles, className)} {...rest}>
      <label className={labelStyles} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}
