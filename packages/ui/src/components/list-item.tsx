import Link from 'next/link';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../lib/cx';

export type ListItemTone = 'danger' | 'amber' | 'accent';
export type ListItemSize = 'default' | 'dense';
export type ListItemVariant = 'todo' | 'nested' | 'feedback';

export interface ListItemProps extends Omit<ComponentPropsWithRef<'li'>, 'title'> {
  href?: string;
  title: ReactNode;
  meta?: ReactNode;
  snippet?: ReactNode;
  /** Left-hand control rendered before the row body (e.g. a done toggle). */
  leading?: ReactNode;
  trailing?: ReactNode;
  deleteAction?: ReactNode;
  /**
   * Nested or feedback: a control on the title line beside `title` — the nested delete
   * affordance, or the feedback status pill. Not beside the child body, so it cannot
   * steal horizontal width from a nested row's children.
   */
  titleAction?: ReactNode;
  /**
   * Presentation: a todo row, a nested row whose `title` is the parent line, or a
   * feedback row whose `titleAction` is the status pill. Opt-in.
   */
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
  titleAction,
  variant,
  size = 'default',
  tone,
  done,
  collapsing,
  className,
  children,
  ...rest
}: Readonly<ListItemProps>) {
  const titleLineCarriesAction =
    (variant === 'nested' || variant === 'feedback') && titleAction != null;

  const titleNode = (
    <span
      className={cx(
        'ui-list-item__title',
        titleLineCarriesAction && 'ui-list-item__title--with-action',
      )}
    >
      {title}
      {titleLineCarriesAction && (
        <span className="ui-list-item__title-action">{titleAction}</span>
      )}
    </span>
  );

  const snippetNode = snippet != null && snippet !== false && (
    <span className="ui-list-item__snippet">{snippet}</span>
  );

  /* The base row reads meta and snippet on one line, separated by a `|`. A
     feedback row gives the description its own line above the meta line, so
     each line reuses the `__sub` typography and no separator is needed. */
  const subNode =
    variant === 'feedback' ? (
      <>
        {snippetNode && <span className="ui-list-item__sub">{snippetNode}</span>}
        <span className="ui-list-item__sub">{meta}</span>
      </>
    ) : (
      <span className="ui-list-item__sub">
        {meta}
        {snippetNode && (
          <>
            <span className="ui-list-item__sep">|</span>
            {snippetNode}
          </>
        )}
      </span>
    );

  const body = (
    <>
      <span className="ui-list-item__text">
        {titleNode}
        {subNode}
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
        variant === 'feedback' && 'ui-list-item--feedback',
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
