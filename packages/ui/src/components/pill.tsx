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
 * Tone → the tint behind the word and the word itself (`REVISED-DESIGN` §8's four pill tones).
 * `FEEDBACK_STATUSES` owns the vocabulary; a status with no signal reads as the neutral pill.
 */
export const pillToneStyles: Record<string, string> = {
  open: 'bg-surface-sunken text-ink-2',
  in_progress: 'bg-warn-soft text-warn',
  done: 'bg-ok-soft text-ok',
  wont_do: 'bg-surface-sunken text-ink-2',
};

/**
 * The two pills the revision draws: `chip` is §8's status pill — 24px tall, 12.5px / 600,
 * riding its tone's tint — and `filter` is §8's `.chip`: the 48px filter control on the
 * strong hairline, filling with the app accent while pressed.
 *
 * Both carry the border width so a colour is never declared twice; the colour arrives from
 * `pillColours`, one pair at a time.
 */
const pillVariants = cva('inline-flex items-center whitespace-nowrap font-semibold rounded-[var(--r-pill)]', {
  variants: {
    size: {
      chip: 'h-[var(--s6)] gap-[var(--s1)] border px-[var(--s2)] text-[length:var(--fs-pill)] tracking-[var(--tracking-pill)]',
      filter: 'min-h-[var(--tap)] border px-[var(--s4)] text-[length:var(--fs-chip)]',
    },
  },
  defaultVariants: { size: 'chip' },
});

/** Shed only the UA button chrome, so a button pill matches its span/anchor twin. */
const toggleStyles =
  'cursor-pointer appearance-none [font-family:inherit] [line-height:inherit] disabled:cursor-default disabled:opacity-50 focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)] focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-focus';

const removeStyles =
  'ui-pill__remove min-h-0 cursor-pointer rounded-[var(--r-pill)] border-0 bg-transparent px-[var(--s1)] py-0 text-[length:var(--fs-meta)] font-semibold leading-none text-ink-2 hover:text-danger [font-family:inherit]';

/** The one colour pair a pill wears: pressed filter, plain filter, or the tone's tint. */
function pillColours(size: PillSize, tone: string | undefined, active: boolean): string {
  if (active) return 'border-max bg-max text-on-max active:bg-max-press';
  if (size === 'filter') return 'border-line-strong bg-surface text-ink active:bg-press';
  return (tone != null && pillToneStyles[tone]) || 'border-transparent bg-surface-sunken text-ink-2';
}

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
  const classes = cx(
    'ui-pill',
    `ui-pill--${size}`,
    tone != null && `ui-pill--${tone}`,
    toggles && 'ui-pill--button',
    active && 'ui-pill--active',
    pillVariants({ size }),
    pillColours(size, tone, active),
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
          className={removeStyles}
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
      <Link href={href} data-slot="badge" className={cx(classes, 'no-underline')} {...linkProps}>
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
