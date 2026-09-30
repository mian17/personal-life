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
    // A pill anchor with NO href is a toggle, not a navigation: next/link with an
    // empty href would reload the page, and an empty-href <a> is invalid. Render
    // a real anchor for the visual contract (inline, `text-decoration: none`, no
    // button chrome) but suppress the default navigation so the caller's onClick
    // toggles state in place. With an href it is a normal next/link.
    const linkProps = rest as unknown as ComponentPropsWithRef<'a'>;
    if (href == null) {
      return (
        <a
          {...linkProps}
          role="button"
          className={classes}
          aria-disabled={disabled || undefined}
          onClick={(event) => {
            event.preventDefault();
            if (disabled) return;
            (linkProps.onClick as ((e: unknown) => void) | undefined)?.(event);
          }}
        >
          {content}
        </a>
      );
    }
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
