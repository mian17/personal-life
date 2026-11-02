// shadcn/ui registry copy (`checkbox`), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
'use client';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export interface CheckboxProps
  extends Omit<ComponentPropsWithRef<typeof CheckboxPrimitive.Root>, 'children' | 'defaultChecked'> {
  /** Filled + check shown. Off by default (an empty square). */
  checked?: boolean;
  /** Accessible name (`aria-label`); the app supplies the frozen text. */
  label?: string;
}

/**
 * The registry root, indicator and check, theme-mapped onto this repo's tokens: `bg-primary`
 * becomes `bg-current`, so the square fills with the row's colour and a `ListItem` tone tints it,
 * and the check is drawn in `--panel` so it reads against the fill. Geometry keeps the
 * `--checkbox-size` hook the todo and dense rows set on their leading control.
 */
const checkboxRoot = cx(
  'peer inline-flex shrink-0 items-center justify-center',
  'size-[var(--checkbox-size,var(--space-0-75))] p-[var(--space-0-15)]',
  'rounded-[var(--space-0-2)] border border-current',
  'cursor-pointer motion-safe:transition-colors outline-none',
  'focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)] focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-accent',
  'disabled:cursor-not-allowed disabled:opacity-50',
  'data-[state=checked]:bg-current',
);

export function Checkbox({ checked = false, label, className, ...rest }: Readonly<CheckboxProps>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      checked={checked}
      aria-label={label}
      className={cx('ui-checkbox', checked && 'ui-checkbox--checked', checkboxRoot, className)}
      {...rest}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="ui-checkbox__glyph grid place-content-center text-panel"
      >
        <Check className="size-full" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
