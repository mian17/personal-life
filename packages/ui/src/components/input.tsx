// shadcn/ui registry copy (`input`), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type InputProps = ComponentPropsWithRef<'input'>;

/**
 * The registry `input` class string, theme-mapped: `border-input` is `--border`, `text-foreground`
 * is `--text`, `placeholder:text-muted-foreground` is `--muted`. `--focus-ring` is a width, not a
 * colour, so focus is the same 2px accent outline the converted buttons draw. `[font:inherit]`
 * stands in for the preflight this package deliberately does not load.
 *
 * Geometry stays a touch field: the registry's `h-9` becomes this repo's 48px `h-12`.
 */
const inputStyles = cx(
  'block w-full min-w-0 h-12 rounded-md border border-border bg-panel px-3 py-2',
  'text-base text-text placeholder:text-muted',
  '[font:inherit] outline-none transition-colors',
  'file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-text',
  'focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)] focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-accent',
  'disabled:cursor-not-allowed disabled:text-muted',
);

export function Input({ className, ...rest }: Readonly<InputProps>) {
  return <input data-slot="input" className={cx('ui-input', inputStyles, className)} {...rest} />;
}
