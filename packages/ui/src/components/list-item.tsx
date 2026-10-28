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

/**
 * The row surface: the panel fill, the row radius clipping the action slots, and the
 * collapse animation. The floor is one two-line row (title + sub) so an empty
 * `meta`/`snippet` cannot collapse it — a dense row is exactly its content height instead.
 */
const rowSurfaceStyles = cx(
  'flex bg-panel rounded-[var(--radius-lg)] overflow-hidden',
  'transition-[height,opacity] duration-[var(--duration-base)] ease-[var(--ease-standard)]',
  '[interpolate-size:allow-keywords]',
);

const rowFloorStyles =
  'min-h-[calc(var(--space-0-9)*2+var(--space-1)*var(--leading)+var(--space-0-15)+var(--space-0-85)*var(--leading))]';

/** A collapsing row animates to nothing while the consumer hides it. */
const collapsingRowStyles = 'h-0 min-h-0 opacity-0 overflow-hidden';

/**
 * Action slots: a form wraps each one, and a danger delete button drops its default tap
 * square for a compact inset so the glyph does not sit flush to the row edge.
 */
const rowSlotStyles = cx(
  '[&>form]:flex',
  '[&>form>.ui-btn--danger]:h-auto [&>form>.ui-btn--danger]:min-h-0',
  '[&>form>.ui-btn--danger]:w-auto [&>form>.ui-btn--danger]:min-w-0',
  '[&>form>.ui-btn--danger]:p-[var(--space-0-5)]',
  '[&>form>.ui-btn--danger]:mr-[var(--space-0-5)]',
  '[&>form>.ui-btn--danger]:rounded-[var(--radius-lg)]',
);

/**
 * Leading checkbox inset: the removed 40px `IconButton` wrapper (`--icon-btn-size`) centred
 * its control, so the checkbox takes that square's leftover width split around it. Direct
 * child only — a row without a leading checkbox matches nothing.
 */
const checkboxInsetStyles =
  '[&>.ui-checkbox]:mx-[calc((var(--icon-btn-size)-var(--checkbox-size,var(--space-0-75)))/2)]';

/**
 * The whole row is the target: the body stretches to the row height and takes its width.
 * Each shape below spells out its own alignment, gap and padding, so nothing is applied
 * twice and no later class has to outrank an earlier one.
 */
const linkSharedStyles =
  'flex flex-1 min-w-0 self-stretch text-inherit no-underline [-webkit-tap-highlight-color:transparent]';

/** One line: meta and snippet share it, the whole line centred against the row. */
const linkRowStyles = cx(
  linkSharedStyles,
  'items-center gap-[var(--space-0-75)] p-[var(--space-0-9)]',
);

/** Nested and feedback rows stack: the title line above the child body. */
const linkColumnStyles = cx(
  linkSharedStyles,
  'flex-col items-stretch gap-[var(--space-0-75)] p-[var(--space-0-9)]',
);

/** Dense todo rows are compact rows, exactly as tall as their content, centred on it. */
const linkDenseStyles = cx(
  linkSharedStyles,
  'items-center gap-[var(--space-0-5)] px-[var(--space-0-4)] py-[var(--space-0-6)]',
);

/** Title above, meta line below, at the tight token gap. */
const textStyles = 'flex flex-col gap-[var(--space-0-15)] flex-1 min-w-0';

const titleBaseStyles = 'font-semibold';

/** The title is one ellipsized line — except a todo row, which reads up to two. */
const titleLineStyles = 'truncate';
const titleClampedStyles = 'line-clamp-2 whitespace-normal';

const denseTextStyles = 'text-[length:var(--space-0-7)]';

const subStyles = cx(
  'flex items-baseline gap-[var(--space-0-4)] min-w-0',
  'text-muted text-[length:var(--space-0-85)]',
  '[&>time]:shrink-0 [&>time]:whitespace-nowrap',
);

const separatorStyles = 'shrink-0 text-border';
const snippetStyles = 'min-w-0 truncate';
const nestedBodyStyles = 'grid gap-[var(--space-0-5)] pl-[var(--space-1)]';

/** The title line carrying its action: the action sits against the title, not the child body. */
const actionLineStyles = cx(
  'flex items-stretch gap-[var(--space-0-5)]',
  '[&>:first-child]:flex-1 [&>:first-child]:min-w-0',
);

/** The action keeps the line's height and never sets one of its own. */
const actionStyles = 'flex items-center shrink-0';

/** A done row is struck and muted; so is the due date that would otherwise read red. */
const doneTitleStyles = 'text-muted line-through';
const doneRowStyles =
  '[&_.ui-icon-btn]:text-muted [&_.ui-checkbox]:text-muted [&_.ui-due-date]:text-muted';

/**
 * A tone tints the leading control of an open coloured-lens row: the checkbox inherits the
 * colour through `border-current`/`bg-current`, the icon controls take it directly.
 */
const toneStyles: Record<ListItemTone, string> = {
  danger: '[&_.ui-checkbox]:text-danger [&_.ui-icon-btn]:text-danger',
  amber: '[&_.ui-checkbox]:text-amber [&_.ui-icon-btn]:text-amber',
  accent: '[&_.ui-checkbox]:text-accent [&_.ui-icon-btn]:text-accent',
};

/** The leading checkbox is bigger in a todo row and compact in its dense scale. */
const todoCheckboxSize = '[--checkbox-size:var(--space-1-25)]';
const denseCheckboxSize = '[--checkbox-size:var(--space-0-75)]';

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
  const isDense = variant === 'todo' && size === 'dense';
  const isColumn = variant === 'nested' || variant === 'feedback';
  const hasSlot = trailing != null || deleteAction != null;

  const linkStyles = isColumn ? linkColumnStyles : isDense ? linkDenseStyles : linkRowStyles;

  const titleNode = (
    <span
      className={cx(
        'ui-list-item__title',
        titleLineCarriesAction && 'ui-list-item__title--with-action',
        titleBaseStyles,
        variant === 'todo' ? titleClampedStyles : titleLineStyles,
        isDense && denseTextStyles,
        done && doneTitleStyles,
        titleLineCarriesAction && actionLineStyles,
      )}
    >
      {title}
      {titleLineCarriesAction && (
        <span className={cx('ui-list-item__title-action', actionStyles)}>{titleAction}</span>
      )}
    </span>
  );

  const snippetNode = snippet != null && snippet !== false && (
    <span className={cx('ui-list-item__snippet', snippetStyles)}>{snippet}</span>
  );

  /* The base row reads meta and snippet on one line, separated by a `|`. A
     feedback row gives the description its own line above the meta line, so
     each line reuses the `__sub` typography and no separator is needed. */
  const subNode =
    variant === 'feedback' ? (
      <>
        {snippetNode && (
          <span className={cx('ui-list-item__sub', subStyles)}>{snippetNode}</span>
        )}
        <span className={cx('ui-list-item__sub', subStyles)}>{meta}</span>
      </>
    ) : (
      <span className={cx('ui-list-item__sub', subStyles, isDense && denseTextStyles)}>
        {meta}
        {snippetNode && (
          <>
            <span className={cx('ui-list-item__sep', separatorStyles)}>|</span>
            {snippetNode}
          </>
        )}
      </span>
    );

  const body = (
    <>
      <span className={cx('ui-list-item__text', textStyles)}>
        {titleNode}
        {subNode}
      </span>
      {variant === 'nested' ? (
        <span className={cx('ui-list-item__nested-body', nestedBodyStyles)}>{children}</span>
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
        isDense && 'ui-list-item--dense',
        variant === 'nested' && 'ui-list-item--nested',
        variant === 'feedback' && 'ui-list-item--feedback',
        done && 'ui-list-item--done',
        collapsing && 'ui-list-item--collapsing',
        tone && `ui-list-item--${tone}`,
        rowSurfaceStyles,
        isDense ? denseCheckboxSize : variant === 'todo' && todoCheckboxSize,
        checkboxInsetStyles,
        isColumn ? 'items-start' : 'items-center',
        isDense ? 'min-h-0' : rowFloorStyles,
        variant === 'nested' && '[&>.ui-icon-btn]:mt-[var(--space-0-9)] [&>form]:mt-[var(--space-0-9)]',
        hasSlot && rowSlotStyles,
        done && doneRowStyles,
        tone && !done && toneStyles[tone],
        collapsing && collapsingRowStyles,
        className,
      )}
      {...rest}
    >
      {leading}
      {href != null ? (
        <Link href={href} className={cx('ui-list-item__link', linkStyles)}>
          {body}
        </Link>
      ) : (
        <span className={cx('ui-list-item__link', linkStyles)}>{body}</span>
      )}
      {trailing}
      {deleteAction}
    </li>
  );
}
