import Link from 'next/link';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../lib/cx';

export type ListItemTone = 'danger' | 'amber' | 'accent';

export interface ListItemProps extends Omit<ComponentPropsWithRef<'li'>, 'title'> {
  href?: string;
  title: ReactNode;
  meta?: ReactNode;
  snippet?: ReactNode;
  /** Left-hand control rendered before the row body (e.g. a done toggle). */
  leading?: ReactNode;
  trailing?: ReactNode;
  deleteAction?: ReactNode;
  /** Compact typography for a small-surface list (matrix quadrants). Off by default. */
  dense?: boolean;
  /** Leading control tint for a coloured lens row (matrix quadrants). Off by default. */
  tone?: ListItemTone;
  /** Done row: struck + de-emphasized (muted). */
  done?: boolean;
  /** Collapsing row: animates to zero height (set by the consumer while hiding). */
  collapsing?: boolean;
}

export function ListItem({
  href,
  title,
  meta,
  snippet,
  leading,
  trailing,
  deleteAction,
  dense,
  tone,
  done,
  collapsing,
  className,
  children,
  ...rest
}: ListItemProps) {
  const body = (
    <>
      <span className="ui-list-item__text">
        <span className="ui-list-item__title">{title}</span>
        <span className="ui-list-item__sub">
          {meta}
          {snippet != null && snippet !== false && (
            <>
              <span className="ui-list-item__sep">|</span>
              <span className="ui-list-item__snippet">{snippet}</span>
            </>
          )}
        </span>
      </span>
      {children}
    </>
  );

  return (
    <li
      className={cx(
        'ui-list-item',
        done && 'ui-list-item--done',
        collapsing && 'ui-list-item--collapsing',
        dense && 'ui-list-item--dense',
        tone && `ui-list-item--${tone}`,
        className,
      )}
      {...rest}
    >
      {leading}
      {href != null ? (
        <Link href={href} className="ui-list-item__link">
          {body}
        </Link>
      ) : (
        <span className="ui-list-item__link">{body}</span>
      )}
      {trailing}
      {deleteAction}
    </li>
  );
}
