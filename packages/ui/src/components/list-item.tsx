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
 * The row surface: one line of slots and body, the press wash, and the collapse animation.
 * The row is transparent inside its group — the group paints the surface and the dividers —
 * so a row only owns its own geometry. The collapse travels on `--d-base`: the
 * `motion-safe:transition-[height,opacity]` utility compiles inside `base.css`'s motion gate,
 * which supplies that §7 duration, and the `reduce` block there is the backstop that
 * collapses it.
 */
const rowSurfaceStyles = cx(
  'flex gap-[var(--s3)] overflow-hidden active:bg-press',
  'motion-safe:transition-[height,opacity]',
  '[interpolate-size:allow-keywords]',
);

/**
 * §8's `.row` box: the row's own insets and its 56px floor, which is what keeps a row without
 * a meta line from collapsing to its title.
 */
const rowBoxStyles = 'min-h-[var(--row-min-height)] px-[var(--s4)] py-[var(--s3)]';

/**
 * A dense row is exactly the tap target tall, on the tighter inset, and narrows the checkbox
 * mark it hosts so the mark never fills the row it sits in. `--s3` (12px) is the dense scale the
 * matrix lens has always drawn: the pre-redesign row set `--checkbox-size` to `0.75rem` here, and
 * `--s3` is that value at the frozen 16px root. The default todo row keeps the control's own
 * mark.
 *
 * The mark's corner travels with its size, because the corner is a fraction of it: the frame's
 * own `--r-sm` (8px) is a third of a 24px mark and a third reads as a box, but on this 12px mark
 * 8px clamps to 6px — half the box — and the mark paints as a disc. `--s1` (4px) holds that same
 * third at the dense scale, so the matrix mark stays the rounded square the list shows.
 *
 * The end inset is one step tighter than the start (`pe-[var(--s2)]`): the pre-redesign dense row
 * ran `0.4rem` at the end against `0.9rem` at the start, and the matrix row has no trailing
 * control for that end inset to clear. The start inset stays `--s3`, the step that matches
 * `0.9rem` within the token scale; the mark's own box lands a quarter of the 48px target past
 * that inset, which is what keeps the target unclipped against the row's `overflow-hidden` edge.
 */
const denseRowStyles =
  'min-h-[var(--tap)] ps-[var(--s3)] pe-[var(--s2)] py-[var(--s2)] [--checkbox-size:var(--s3)] [--checkbox-radius:var(--s1)]';

/**
 * Action slots: a form wraps each one, and a danger delete button drops its default tap
 * square for a compact inset. The row's own end inset has already placed the slot, so the
 * glyph needs no negative margin to land on the text edge.
 */
const rowSlotStyles = cx(
  '[&>form]:flex',
  '[&>form>.ui-btn--danger]:h-auto [&>form>.ui-btn--danger]:min-h-0',
  '[&>form>.ui-btn--danger]:w-auto [&>form>.ui-btn--danger]:min-w-0',
  '[&>form>.ui-btn--danger]:p-[var(--s2)]',
  '[&>form>.ui-btn--danger]:rounded-[var(--r-md)]',
);

/**
 * The whole row is the target: the body stretches to the row height and takes its width.
 * Each shape below spells out its own alignment and gap, so nothing is applied twice and no
 * later class has to outrank an earlier one. Padding lives on the row box, not here, so the
 * slots and the body share one inset.
 */
const linkSharedStyles =
  'flex flex-1 min-w-0 self-stretch text-inherit no-underline [-webkit-tap-highlight-color:transparent]';

/** One line: meta and snippet share it, the whole line centred against the row. */
const linkRowStyles = cx(linkSharedStyles, 'items-center gap-[var(--s2)]');

/** Nested and feedback rows stack: the title line above the child body. */
const linkColumnStyles = cx(linkSharedStyles, 'flex-col items-stretch gap-[var(--s2)]');

/**
 * A dense row packs its line tighter than a full row. The mark-to-title gap is the pre-redesign
 * `0.5rem` (`--s2`), not the tighter `--s1` the redesigned row shrank it to.
 */
const linkDenseStyles = cx(linkSharedStyles, 'items-center gap-[var(--s2)]');

/** Title above, meta line below, one spacing step apart. */
const textStyles = 'flex flex-col gap-[var(--s1)] flex-1 min-w-0';

/** §8's `.row__title`: 16px at 1.35, semibold, set slightly tight. */
const titleBaseStyles =
  'font-semibold leading-[var(--lh-row-title)] tracking-[var(--tracking-row-title)]';

const titleSizeStyles = 'text-[length:var(--fs-row-title)]';

/** A dense row's title drops to the meta size, so a quadrant row reads as one compact block. */
const denseTitleSizeStyles = 'text-[length:var(--fs-meta)]';

/** The title is one ellipsized line — except a todo row, which reads up to two. */
const titleLineStyles = 'truncate';
const titleClampedStyles = 'line-clamp-2 whitespace-normal';

/** §8's `.row__meta`: the second ink tier, one step below the title. */
const subStyles = cx(
  'flex items-baseline gap-[var(--s1)] min-w-0',
  'text-ink-2 text-[length:var(--fs-meta)] leading-[var(--lh-meta)]',
  '[&>time]:shrink-0 [&>time]:whitespace-nowrap',
);

const separatorStyles = 'shrink-0 text-ink-3';
const snippetStyles = 'min-w-0 truncate';
const nestedBodyStyles = 'grid gap-[var(--s2)]';

/**
 * A nested body spans its column, but a title line carrying an action gives that action a
 * full tap target plus the action-line gap, so the body reserves the same column and a child
 * field shares the title field's edges.
 */
const nestedBodyActionInsetStyles = 'pr-[calc(var(--tap)+var(--s2))]';

/** The title line carrying its action: the action sits against the title, not the child body. */
const actionLineStyles = cx(
  'flex items-stretch gap-[var(--s2)]',
  '[&>:first-child]:flex-1 [&>:first-child]:min-w-0',
);

/** The action keeps the line's height and never sets one of its own. */
const actionStyles = 'flex items-center shrink-0';

/** A done row is struck and muted; so is the due date that would otherwise read red. */
const doneTitleStyles = 'text-ink-2 line-through';
const doneRowStyles =
  '[&_.ui-icon-btn]:text-ink-3 [&_.ui-checkbox]:text-ink-3 [&_.ui-due-date]:text-ink-3';

/**
 * A tone tints the leading control of an open coloured-lens row: the checkbox inherits the
 * colour through `border-current`/`bg-current`, the icon controls take it directly.
 */
const toneStyles: Record<ListItemTone, string> = {
  danger: '[&_.ui-checkbox]:text-danger [&_.ui-icon-btn]:text-danger',
  amber: '[&_.ui-checkbox]:text-warn [&_.ui-icon-btn]:text-warn',
  accent: '[&_.ui-checkbox]:text-max [&_.ui-icon-btn]:text-max',
};

/** The row's computed shape, resolved once so every class and node builder reads one source. */
interface RowFlags {
  variant: ListItemVariant | undefined;
  isDense: boolean;
  isColumn: boolean;
  hasSlot: boolean;
  carriesAction: boolean;
  done: boolean | undefined;
  collapsing: boolean | undefined;
  tone: ListItemTone | undefined;
}

/** The link body layout: a column row stacks, a dense row packs tight, the base row runs one line. */
function linkStylesFor({ isColumn, isDense }: Readonly<RowFlags>): string {
  if (isColumn) return linkColumnStyles;
  if (isDense) return linkDenseStyles;
  return linkRowStyles;
}

function titleSizeStylesFor(isDense: boolean): string {
  return isDense ? denseTitleSizeStyles : titleSizeStyles;
}

function titleNodeFor(
  { variant, isDense, done, carriesAction }: Readonly<RowFlags>,
  title: ReactNode,
  titleAction: ReactNode,
): ReactNode {
  return (
    <span
      className={cx(
        'ui-list-item__title',
        carriesAction && 'ui-list-item__title--with-action',
        titleBaseStyles,
        titleSizeStylesFor(isDense),
        variant === 'todo' ? titleClampedStyles : titleLineStyles,
        done && doneTitleStyles,
        carriesAction && actionLineStyles,
      )}
    >
      {title}
      {carriesAction && (
        <span className={cx('ui-list-item__title-action', actionStyles)}>{titleAction}</span>
      )}
    </span>
  );
}

function subNodeFor(
  { variant }: Readonly<RowFlags>,
  meta: ReactNode,
  snippet: ReactNode,
): ReactNode {
  const snippetNode = snippet != null && snippet !== false && (
    <span className={cx('ui-list-item__snippet', snippetStyles)}>{snippet}</span>
  );

  /* The base row reads meta and snippet on one line, separated by a `|`. A
     feedback row gives the description its own line above the meta line, so
     each line reuses the `__sub` typography and no separator is needed. */
  return variant === 'feedback' ? (
    <>
      {snippetNode && <span className={cx('ui-list-item__sub', subStyles)}>{snippetNode}</span>}
      <span className={cx('ui-list-item__sub', subStyles)}>{meta}</span>
    </>
  ) : (
    <span className={cx('ui-list-item__sub', subStyles)}>
      {meta}
      {snippetNode && (
        <>
          <span className={cx('ui-list-item__sep', separatorStyles)}>|</span>
          {snippetNode}
        </>
      )}
    </span>
  );
}

/** The row's locator hooks, kept in one string so consumers can target the shape. */
function rowHookClassesFor({
  variant,
  isDense,
  done,
  collapsing,
  tone,
}: Readonly<RowFlags>): string {
  return cx(
    'ui-list-item',
    variant === 'todo' && 'ui-list-item--todo',
    isDense && 'ui-list-item--dense',
    variant === 'nested' && 'ui-list-item--nested',
    variant === 'feedback' && 'ui-list-item--feedback',
    done && 'ui-list-item--done',
    collapsing && 'ui-list-item--collapsing',
    tone && `ui-list-item--${tone}`,
  );
}

/** A collapsing row animates to nothing while the consumer hides it. */
const collapsingRowStyles = 'h-0 min-h-0 opacity-0 overflow-hidden';

/**
 * The row's utility classes: surface, box, alignment, slots, and state treatment. A dense row
 * top-aligns its slots so its leading mark rides the title's first line: the 48px target centres
 * its 12px mark on itself, and a centred target cannot lift that mark above the row's top edge
 * without bleeding past the row's `overflow-hidden` clip, so the top edge is the mark's ceiling.
 */
function rowStyleClassesFor({
  isDense,
  isColumn,
  hasSlot,
  done,
  collapsing,
  tone,
}: Readonly<RowFlags>): string {
  return cx(
    rowSurfaceStyles,
    isDense ? denseRowStyles : rowBoxStyles,
    isColumn || isDense ? 'items-start' : 'items-center',
    hasSlot && rowSlotStyles,
    done && doneRowStyles,
    tone && !done && toneStyles[tone],
    collapsing && collapsingRowStyles,
  );
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
  const flags: RowFlags = {
    variant,
    isDense: variant === 'todo' && size === 'dense',
    isColumn: variant === 'nested' || variant === 'feedback',
    hasSlot: trailing != null || deleteAction != null,
    carriesAction: (variant === 'nested' || variant === 'feedback') && titleAction != null,
    done,
    collapsing,
    tone,
  };

  const body = (
    <>
      <span className={cx('ui-list-item__text', textStyles)}>
        {titleNodeFor(flags, title, titleAction)}
        {subNodeFor(flags, meta, snippet)}
      </span>
      {variant === 'nested' ? (
        <span
          className={cx(
            'ui-list-item__nested-body',
            nestedBodyStyles,
            flags.carriesAction && nestedBodyActionInsetStyles,
          )}
        >
          {children}
        </span>
      ) : (
        children
      )}
    </>
  );

  return (
    <li className={cx(rowHookClassesFor(flags), rowStyleClassesFor(flags), className)} {...rest}>
      {leading}
      {href != null ? (
        <Link href={href} className={cx('ui-list-item__link', linkStylesFor(flags))}>
          {body}
        </Link>
      ) : (
        <span className={cx('ui-list-item__link', linkStylesFor(flags))}>{body}</span>
      )}
      {trailing}
      {deleteAction}
    </li>
  );
}
