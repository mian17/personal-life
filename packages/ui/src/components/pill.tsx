import type { ComponentPropsWithRef, ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from '../lib/cx';

export type PillSize = 'chip' | 'filter';
export type PillTag = 'span' | 'a';

export interface PillProps extends ComponentPropsWithRef<'span'> {
  size?: PillSize;
  active?: boolean;
  as?: PillTag;
  href?: string;
  onRemove?: () => void;
  removeLabel?: string;
  children?: ReactNode;
}

export function Pill({
  size = 'chip',
  active = false,
  as = 'span',
  href,
  onRemove,
  removeLabel,
  className,
  children,
  ...rest
}: PillProps) {
  const classes = cx('ui-pill', `ui-pill--${size}`, active && 'ui-pill--active', className);

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
    // The atom renders either a span or an anchor; a single prop bag cannot be
    // statically narrowed, so the anchor branch re-types it at the boundary.
    const anchorProps = rest as unknown as ComponentPropsWithRef<'a'>;
    return (
      <a href={href} className={classes} {...anchorProps}>
        {content}
      </a>
    );
  }

  return (
    <span className={classes} {...rest}>
      {content}
    </span>
  );
}
