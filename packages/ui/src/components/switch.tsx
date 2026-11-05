// shadcn/ui registry copy (`switch`), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
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

/**
 * The revised control language applied to the switch the revision does not draw: the track
 * is the two-step pill, the thumb one 16px step, and one thumb-travel of extra width, so the
 * checked thumb lands on the track's right inner edge.
 *
 * Colour follows the accent rule: an off track is the strong hairline, an on track the app
 * accent, and the thumb stays the raised surface so it reads on both.
 */
const switchTrack = cx(
  'relative inline-flex shrink-0 items-center',
  'h-[var(--s6)] w-[calc(var(--s6)+var(--s5))] p-[var(--s1)]',
  'rounded-[var(--r-pill)] border-0 bg-line-strong data-[state=checked]:bg-max',
  'cursor-pointer motion-safe:transition-colors outline-hidden',
  // `outline-hidden` zeroes `--tw-outline-style`, and `outline-<width>` draws with that
  // variable — so the ring needs `outline-solid` to exist. Without it Chromium computes
  // `outline-style: none` and the focus ring is invisible.
  'focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)] focus-visible:outline-offset-[var(--focus-ring)]',
  'focus-visible:outline-focus',
  'disabled:cursor-default disabled:opacity-50',
);

const switchThumb = cx(
  'pointer-events-none block size-[var(--s4)] rounded-[var(--r-pill)] bg-surface',
  'motion-safe:transition-transform data-[state=checked]:translate-x-[var(--s5)]',
);

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
  name,
  className,
}: Readonly<SwitchProps>) {
  return (
    <SwitchPrimitive.Root
      asChild
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
    >
      <button
        type="button"
        name={name}
        aria-label={label}
        data-slot="switch"
        className={cx('ui-switch', checked && 'ui-switch--on', switchTrack, className)}
      >
        <SwitchPrimitive.Thumb data-slot="switch-thumb" className={switchThumb} />
      </button>
    </SwitchPrimitive.Root>
  );
}
