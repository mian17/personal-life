import Link from 'next/link';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../lib/cx';

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
    <li className={cx('ui-list-item', dense && 'ui-list-item--dense', className)} {...rest}>
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
