import Link from 'next/link';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from '../lib/cx';

export type PillSize = 'chip' | 'filter';
export type PillTag = 'span' | 'a' | 'button';
export type PillButtonType = 'button' | 'submit' | 'reset';

export interface PillProps extends ComponentPropsWithRef<'span'> {
  size?: PillSize;
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
}: PillProps) {
  const classes = cx(
    'ui-pill',
    `ui-pill--${size}`,
    as === 'button' && 'ui-pill--button',
    active && 'ui-pill--active',
    className,
  );

  if (as === 'button') {
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

  if (as === 'a') {
    // The atom renders either a span or a link; a single prop bag cannot be
    // statically narrowed, so the link branch re-types it at the boundary. The
    // legacy `.filters a` pills used next/link, so client-side navigation is
    // preserved (not a raw <a> full document load).
    const linkProps = rest as unknown as ComponentPropsWithRef<'a'>;
    return (
      <Link href={href ?? ''} className={classes} {...linkProps}>
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
