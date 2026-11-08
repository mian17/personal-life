// shadcn/ui registry copy (`button`, icon control), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type IconButtonVariant = 'default' | 'ghost' | 'framed';

export interface IconButtonProps extends ComponentPropsWithRef<'button'> {
  label: string;
  variant?: IconButtonVariant;
}

/**
 * Shared by every variant: the 48px tap target on `--r-md`, the `--press` wash under the finger,
 * the focus ring and the disabled treatment. Face — ink, border and fill — belongs to the variant
 * below, so two utilities never contest one property on the same element.
 *
 * `shrink-0` keeps the square at `--tap` inside a flex row: a `w-full` sibling (the create and rename
 * rows) bases itself on the whole row, and the 56px deficit would otherwise be shared with this
 * control, shaving it under the 44px floor.
 */
const iconButtonStyles = cx(
  'inline-flex size-[var(--tap)] shrink-0 items-center justify-center',
  'rounded-[var(--r-md)]',
  'cursor-pointer outline-none motion-safe:transition-colors active:bg-press',
  'focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)] focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-focus',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

/**
 * The revised `.iconbtn` (REVISED-DESIGN §8): a 48px transparent square carrying an
 * `--ink-2` glyph, washing to `--press` under the finger and never drawing a border. It is the
 * face of every icon control in the todos and meals editors, which name no variant.
 */
const iconButtonBorderlessStyles = cx(iconButtonStyles, 'border-0 bg-transparent text-ink-2');

/** `IconLink variant="framed"`'s face on a button: the `--line` hairline on `--surface`, full ink. */
const iconButtonFramedStyles = cx(iconButtonStyles, 'border border-line bg-surface text-ink');

/**
 * Two fixed faces, so plain strings composed with `cx` — no cva. `default` and `ghost` are the
 * same borderless square (the revision gives the icon button one look; the prop stays for the
 * call sites that name it). `framed` is the notes settings back button's face, used by the note
 * editor's own back control and its "Note actions" trigger.
 */
const iconButtonVariantStyles: Record<IconButtonVariant, string> = {
  default: iconButtonBorderlessStyles,
  ghost: iconButtonBorderlessStyles,
  framed: iconButtonFramedStyles,
};

export function IconButton({
  label,
  variant = 'default',
  className,
  children,
  ...rest
}: Readonly<IconButtonProps>) {
  return (
    <button
      type="button"
      aria-label={label}
      data-slot="button"
      className={cx(
        'ui-icon-btn',
        variant !== 'default' && `ui-icon-btn--${variant}`,
        iconButtonVariantStyles[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
