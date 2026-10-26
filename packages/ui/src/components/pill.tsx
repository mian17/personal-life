import Link from 'next/link';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from '../lib/cx';

export type PillSize = 'chip' | 'filter';
export type PillTag = 'span' | 'a' | 'button';
export type PillButtonType = 'button' | 'submit' | 'reset';

export interface PillProps extends ComponentPropsWithRef<'span'> {
  size?: PillSize;
  /**
   * Semantic modifier for a status/tone-coloured pill, e.g. `'open' | 'done'`.
   * Must name an existing `.ui-pill--<tone>` rule in `atoms.css`.
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
    className,
  );

  if (toggles) {
    // A chip that toggles state is a control, not a label: render a real button.
    // `onRemove` is a non-interactive-chip affordance and is deliberately not
    // rendered here (a button inside a button is invalid HTML).
    const buttonProps = rest as unknown as ComponentPropsWithRef<'button'>;
    return (
      <button type={buttonType} className={classes} disabled={disabled} {...buttonProps}>
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
          className="ui-pill__remove"
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
      <Link href={href} className={classes} {...linkProps}>
        {content}
      </Link>
    );
  }

  return (
    <span className={classes} {...rest}>
      {content}
    </span>
  );
}
