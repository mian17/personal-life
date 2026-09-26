import Link from 'next/link';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface ListItemProps extends Omit<ComponentPropsWithRef<'li'>, 'title'> {
  href?: string;
  title: ReactNode;
  meta?: ReactNode;
  snippet?: ReactNode;
  trailing?: ReactNode;
  deleteAction?: ReactNode;
}

export function ListItem({
  href,
  title,
  meta,
  snippet,
  trailing,
  deleteAction,
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
    <li className={cx('ui-list-item', className)} {...rest}>
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
