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
 * The registry track and thumb, with the geometry taken from the spacing tokens rather
 * than the utility scale so the switch keeps its `1rem + 0.4rem` height and one thumb
 * travel of extra width: thumb `1rem`, inset `0.2rem`. Colours are theme-mapped:
 * track `--border` off / `--accent` on, thumb `--muted` off / `--on-accent` on.
 */
const switchTrack = cx(
  'relative inline-flex shrink-0 items-center',
  'h-[calc(var(--space-1)+var(--space-0-4))]',
  'w-[calc(var(--space-1)+var(--space-0-4)+var(--space-1-25))]',
  'p-[var(--space-0-2)] rounded-full border-0',
  'bg-border data-[state=checked]:bg-accent',
  'cursor-pointer motion-safe:transition-colors outline-hidden',
  // `outline-hidden` zeroes `--tw-outline-style`, and `outline-<width>` draws with that
  // variable — so the ring needs `outline-solid` to exist. Without it Chromium computes
  // `outline-style: none` and the focus ring is invisible.
  'focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)] focus-visible:outline-offset-[var(--focus-ring)]',
  'focus-visible:outline-accent',
  'disabled:cursor-default disabled:opacity-50',
);

const switchThumb = cx(
  'pointer-events-none block size-[var(--space-1)] rounded-full bg-muted',
  'motion-safe:transition-transform data-[state=checked]:translate-x-[var(--space-1-25)]',
  'data-[state=checked]:bg-on-accent',
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
