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
 * The revised `.check` (REVISED-DESIGN §8, §11): a 24px mark painted inside a 48px target.
 * The root is the target — full `--tap`, `--r-md`, pressing to `--press` — so the tap surface
 * never shrinks to the size of the mark a reader is aiming at.
 * §8's negative offsets travel with it: the target bleeds `--s2` over the row's block padding
 * and `--s3` over its start padding, so a 48px target adds no height to a dense row and the
 * mark lands on the row's own text inset. Row-side insets stay with the row primitives that
 * own row geometry (`list-item`'s `has-[>.ui-checkbox]` padding, and a dense row's zero start
 * padding, which clips the target's start half against the row edge).
 */
const checkboxTarget = cx(
  'ui-checkbox peer group grid shrink-0 place-items-center',
  'size-[var(--tap)] rounded-[var(--r-md)] border-0 bg-transparent',
  '-my-[var(--s2)] -ms-[var(--s3)]',
  'cursor-pointer motion-safe:transition-colors active:bg-press outline-none',
  'focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)] focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-focus',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

/**
 * The revised `.check__box`: the mark's frame. `--checkbox-size` (24px) is the hook a dense row
 * narrows, and the box carries no padding.
 */
const checkboxBox = cx(
  'ui-checkbox__box grid size-[var(--checkbox-size)] place-items-center',
  'rounded-[var(--r-sm)] border-[length:var(--border-width-strong)] border-line-strong',
  'bg-surface text-transparent',
  'group-data-[state=checked]:border-max group-data-[state=checked]:bg-max group-data-[state=checked]:text-on-max',
);

export function Checkbox({ checked = false, label, className, ...rest }: Readonly<CheckboxProps>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      checked={checked}
      aria-label={label}
      className={cx('ui-checkbox', checked && 'ui-checkbox--checked', checkboxTarget, className)}
      {...rest}
    >
      <span data-slot="checkbox-box" className={checkboxBox}>
        <CheckboxPrimitive.Indicator
          data-slot="checkbox-indicator"
          className="ui-checkbox__glyph grid size-full place-content-center"
        >
          <Check className="size-[min(var(--s4),100%)]" strokeWidth={3} />
        </CheckboxPrimitive.Indicator>
      </span>
    </CheckboxPrimitive.Root>
  );
}
