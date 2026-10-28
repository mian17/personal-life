// shadcn/ui registry copy (`badge`), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
import Link from 'next/link';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cva } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cx } from '../lib/cx';

export type PillSize = 'chip' | 'filter';
export type PillTag = 'span' | 'a' | 'button';
export type PillButtonType = 'button' | 'submit' | 'reset';

export interface PillProps extends ComponentPropsWithRef<'span'> {
  size?: PillSize;
  /**
   * Semantic modifier for a status/tone-coloured pill, e.g. `'open' | 'done'`.
   * Must name a row of `pillToneStyles`; an unknown tone colours nothing.
   */
  tone?: string;
  active?: boolean;
  as?: PillTag;
  href?: string;
  disabled?: boolean;
  buttonType?: PillButtonType;
  onRemove?: () => void;
  removeLabel?: string;
  children?: ReactNode;
}

/**
 * Tone → text colour, one row per feedback status (`FEEDBACK_STATUSES` owns the
 * vocabulary and the token each value maps to). A colour name is its token name
 * minus `--`, resolved by the `@theme` block in `theme.css`.
 */
export const pillToneStyles: Record<string, string> = {
  open: 'text-accent',
  in_progress: 'text-amber',
  done: 'text-green',
  wont_do: 'text-muted',
};

/**
 * The registry `badge` shell, theme-mapped: `chip` is the bordered status chip,
 * `filter` the borderless navigation pill. Geometry rides the spacing tokens so
 * both sizes keep the padding and type they carried as hand-written CSS.
 */
const pillVariants = cva('inline-flex items-center rounded-full', {
  variants: {
    size: {
      chip: 'gap-[var(--space-0-3)] border border-border px-[var(--space-0-5)] py-[var(--space-0-2)] text-[length:var(--space-0-8)]',
      filter:
        'border-0 px-[var(--space-0-7)] py-[var(--space-0-35)] text-[length:var(--space-0-85)] no-underline',
    },
  },
  defaultVariants: { size: 'chip' },
});

/** Shed only the UA button chrome, so a button pill matches its span/anchor twin. */
const toggleStyles =
  'cursor-pointer appearance-none [font-family:inherit] [line-height:inherit] disabled:cursor-default disabled:opacity-50 focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)] focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-accent';

const removeStyles =
  'min-h-0 cursor-pointer rounded-full border-0 bg-transparent px-[var(--space-0-35)] py-0 text-[length:var(--space-0-95)] font-semibold leading-none text-muted hover:text-danger [font-family:inherit]';

export function Pill({
  size = 'chip',
  tone,
  active = false,
  as = 'span',
  href,
  disabled,
  buttonType = 'button',
  onRemove,
  removeLabel,
  className,
  children,
  ...rest
}: Readonly<PillProps>) {
  // A pill that acts without navigating is a button, whatever tag was asked for:
  // an anchor with no href is not focusable or keyboard-activatable on its own,
  // and patching that with `role`/`tabIndex`/a hand-written Space handler only
  // reimplements what <button> already does.
  const toggles = as === 'button' || (as === 'a' && href == null);
  // One colour pair per pill, never two competing utilities: an active pill is the
  // accent fill, otherwise the panel surface with the tone's text colour.
  const colours = active
    ? 'bg-accent text-on-accent'
    : cx('bg-panel', (tone != null && pillToneStyles[tone]) || 'text-muted');
  const classes = cx(
    'ui-pill',
    `ui-pill--${size}`,
    tone != null && `ui-pill--${tone}`,
    toggles && 'ui-pill--button',
    active && 'ui-pill--active',
    pillVariants({ size }),
    colours,
    toggles && toggleStyles,
    className,
  );

  if (toggles) {
    // A chip that toggles state is a control, not a label: render a real button.
    // `onRemove` is a non-interactive-chip affordance and is deliberately not
    // rendered here (a button inside a button is invalid HTML).
    const buttonProps = rest as unknown as ComponentPropsWithRef<'button'>;
    return (
      <button
        type={buttonType}
        data-slot="badge"
        className={classes}
        disabled={disabled}
        {...buttonProps}
      >
        {children}
      </button>
    );
  }

  const content = (
    <>
      {children}
      {onRemove && (
        <button
          type="button"
          className={cx('ui-pill__remove', removeStyles)}
          aria-label={removeLabel}
          onClick={onRemove}
        >
          <X size={14} aria-hidden />
        </button>
      )}
    </>
  );

  if (as === 'a' && href != null) {
    // The no-href case was handled above as a button, so this branch always navigates.
    const linkProps = rest as unknown as ComponentPropsWithRef<'a'>;
    return (
      <Link href={href} data-slot="badge" className={classes} {...linkProps}>
        {content}
      </Link>
    );
  }

  return (
    <span data-slot="badge" className={classes} {...rest}>
      {content}
    </span>
  );
}
