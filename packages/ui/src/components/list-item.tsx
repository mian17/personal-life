import Link from 'next/link';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../lib/cx';

export type ListItemTone = 'danger' | 'amber' | 'accent';
export type ListItemSize = 'default' | 'dense';
export type ListItemVariant = 'todo' | 'nested';

export interface ListItemProps extends Omit<ComponentPropsWithRef<'li'>, 'title'> {
  href?: string;
  title: ReactNode;
  meta?: ReactNode;
  snippet?: ReactNode;
  /** Left-hand control rendered before the row body (e.g. a done toggle). */
  leading?: ReactNode;
  trailing?: ReactNode;
  deleteAction?: ReactNode;
  /** Presentation: a todo row, or a nested row whose `title` is the parent line. Opt-in. */
  variant?: ListItemVariant;
  /** Row scale for the todo variant. No effect without variant="todo". Defaults to 'default'. */
  size?: ListItemSize;
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
  variant,
  size = 'default',
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
      {variant === 'nested' ? (
        <span className="ui-list-item__nested-body">{children}</span>
      ) : (
        children
      )}
    </>
  );

  return (
    <li
      className={cx(
        'ui-list-item',
        variant === 'todo' && 'ui-list-item--todo',
        variant === 'todo' && size === 'dense' && 'ui-list-item--dense',
        variant === 'nested' && 'ui-list-item--nested',
        done && 'ui-list-item--done',
        collapsing && 'ui-list-item--collapsing',
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
