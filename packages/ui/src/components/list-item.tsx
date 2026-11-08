import Link from 'next/link';
import { isValidElement, type ComponentPropsWithRef, type ReactNode } from 'react';
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
 * `0.9rem` within the token scale — it places the title, not the mark (see below).
 *
 * The leading control is taken out of flow. Its target is a full 48px square, and in flow that
 * square reserved 48px of row width, so the title started 60px from the row edge where the
 * pre-redesign row started it at 26.4px — the mark itself was always the right size and in the
 * right place. The row becomes the target's positioning context and the target is pinned to the
 * row's start/top corner, so no part of the 48px press square leaves the row's `overflow-hidden`
 * clip. The offsets are stated net of the primitive's own negative margins (`-my-[var(--s2)]`
 * `-ms-[var(--s3)]`), because a margin still applies to an absolutely positioned box: `--s4`
 * start and `--s2` top land the painted square one step inside the corner without re-declaring a
 * margin the control owns. The mark is centred in the target (`justify-items-center`, a longhand
 * of the target's `place-items-center` shorthand, so it wins without touching the control), so it
 * sits on the press square's own centre rather than pinned to an edge — measured, mark 22→34 in a
 * target of 4→52. No inset rides on the mark: an inset still applies inside a centring box, so a
 * `--s2` trailing margin would push the mark 4px off centre, and centring only holds with the
 * inset gone. The mark therefore sits 4px further from the title than a trailing alignment put
 * it (26→38 became 22→34, title still at 52): the mark→title gap is 18px where it was 14px.
 *
 * The target keeps an `--s4` start offset, not the row's own `--s3`. On a dense row the square's
 * trailing edge is what matters: it ends at `--s1 + --tap` = 52px, exactly where the title starts,
 * and an `--s3` start would end it at 48 and put 4px of press square over the title's first
 * characters — a tap there completes the todo instead of opening it. `--s4` holds the square flush
 * with the title; the centring then places the mark inside it.
 *
 * The press square is a `--tap` square ending 52px from the row's edge (`--s1 + --tap`), so the
 * title starts at or past 52 or the square swallows it. The link's old `--s4` put the title at 28,
 * which left the square's trailing 24px over the first characters of every title — a tap there
 * completed the todo instead of opening it. `linkDenseStyles` now starts the title at 52: flush
 * with the square's trailing edge, no overlap, and the full string still in the DOM.
 *
 * Vertically the mark cannot keep the target's centring. The target starts on the row's top edge,
 * so its centre is `--tap`/2 = 24px down; the title's first line starts one `--s2` down and is one
 * `--lh-row-title` line tall, so its centre is at 17.11px on the dense scale — the mark painted
 * 6.89px low, and by the same amount on a two-line title, because a second line never moves the
 * first. Lifting the 48px square would push it 6.89px outside the row's `overflow-hidden` clip, so
 * the square keeps the corner and the mark alone is lifted by the target's half-height less the
 * row's top inset less the first line's half-height. The offset is stated from the title's own
 * hooks (`--fs-meta` at `--lh-row-title`), so it follows the line if the dense type scale moves.
 *
 * The vertical padding lives on the link (`linkDenseStyles`), not here: on the row it left an 8px
 * band above and below the anchor that a tap did nothing in. The link spans the row's full height
 * — 57.11px for a title and a meta line — so the whole row navigates. The target's `top` is an
 * offset from the row's border box, so the padding move leaves the mark where it is.
 *
 * `min-h-[var(--tap)]` keeps the row as tall as the target it no longer gets height from.
 *
 * The target's own press wash stays silenced (`:active`): it no longer covers text, but the row
 * already washes on press (`rowSurfaceStyles`), and a second `--press` square would paint the
 * row's left gutter twice in one gesture.
 */
const denseRowStyles =
  'relative min-h-[var(--tap)] ps-[var(--s3)] pe-[var(--s2)] [--checkbox-size:var(--s3)] [--checkbox-radius:var(--s1)] [&>.ui-checkbox]:absolute [&>.ui-checkbox]:start-[var(--s4)] [&>.ui-checkbox]:top-[var(--s2)] [&>.ui-checkbox]:justify-items-center [&>.ui-checkbox:active]:bg-transparent [&>.ui-checkbox>*]:-translate-y-[calc(var(--tap)/2-var(--s2)-var(--fs-meta)*var(--lh-row-title)/2)]';

/**
 * Action slots: a form wraps each one, and a danger delete button takes a floor instead of
 * `size="icon"`'s square. The slot's `h-auto`/`w-auto` otherwise let the box shrink to its own
 * `--s2` inset plus the glyph — 34px, under the 44px floor the contract sets. The floor is
 * declared on the variant, so both shapes in the slot inherit it: a `size="icon"` danger button
 * and the unsized `ConfirmButton` the trash screens render.
 *
 * The glyph itself does not move: the box is anchored on the row's end inset, so its trailing edge
 * is fixed, and `justify-end` puts the 18px glyph against that same trailing padding — its
 * position is identical in the 34px box and the `--tap` one; only the leading edge travelled. The
 * variant selector reaches the button with a class and an element, so it outranks the `Button`
 * base's own `justify-center` without needing `!important`.
 *
 * The floor adds no row height because of the negative block margin: a `--tap` box in flow is
 * taller than the row's content box (`--row-min-height` less `2 × --s3` = 32px), so the box hands
 * 8px of itself back over each edge and the row keeps the height its text column asks for.
 */
const rowSlotStyles = cx(
  '[&>form]:flex',
  '[&>form>.ui-btn--danger]:h-auto [&>form>.ui-btn--danger]:min-h-[var(--tap)]',
  '[&>form>.ui-btn--danger]:w-auto [&>form>.ui-btn--danger]:min-w-[var(--tap)]',
  '[&>form>.ui-btn--danger]:justify-end',
  '[&>form>.ui-btn--danger]:-my-[var(--s2)]',
  '[&>form>.ui-btn--danger]:p-[var(--s2)]',
  '[&>form>.ui-btn--danger]:rounded-[var(--r-md)]',
);

/**
 * The whole row is the target: the body stretches to the row height and takes its width.
 * Each shape below spells out its own alignment and gap, so nothing is applied twice and no
 * later class has to outrank an earlier one. The horizontal insets live on the row box so the
 * slots and the body share them; the vertical padding lives on the link of a dense row
 * (`linkDenseStyles`), whose row box carries none — a row inset the anchor does not span is a
 * band a tap passes through.
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
 *
 * The start inset is where the checkbox's press square ends: the square's start is the control's
 * `--s4` offset less its own `-ms-[var(--s3)]` (`--s1`), and it is `--tap` wide, so it ends at
 * `--s1 + --tap` = 52px. The row's own `ps-[var(--s3)]` already covers 12 of that, so the link
 * starts the title at `--tap + --s1 - --s3` = 40px more, 52px from the row edge — flush with the
 * square, no overlap, and the title keeps its full string in the DOM.
 *
 * It lives here rather than on the row because a child-selector utility cannot name this class:
 * Tailwind reads the `__` in `[&>.ui-list-item__link]` as a descendant combinator and compiles a
 * rule that never matches.
 *
 * The row's `--s2` block inset lives here too, so the anchor is as tall as the row and the 8px
 * band above and below a matrix title navigates instead of doing nothing. The padding is stated
 * here, not on the row, so the title's first line still starts one `--s2` down — the mark's lift
 * formula is measured against that inset and does not move.
 */
const linkDenseStyles = cx(
  linkSharedStyles,
  'items-center gap-[var(--s2)]',
  'ps-[calc(var(--tap)+var(--s1)-var(--s3))] py-[var(--s2)] min-h-[var(--tap)]',
);

/**
 * Title above, meta line below, one spacing step apart. A feedback row stacks three lines in this
 * column, so this one step pairs the title with its date; that row's description adds
 * `feedbackDescriptionStyles` to reach the next step.
 */
const textStyles = 'flex flex-col gap-[var(--s1)] flex-1 min-w-0';

/**
 * A feedback description is the row's next block, not a third line of the date. The title and its
 * date read as one pair one `--s1` step apart; this margin is `--s2` (8px) on top of the column's
 * `--s1` gap, so the description opens `--s2` + `--s1` = 12px below the date. One margin is the
 * whole cost — a row-specific spacing value, not a new token.
 */
const feedbackDescriptionStyles = 'mt-[var(--s2)]';

/** §8's `.row__title`: 16px at 1.35, semibold, set slightly tight. */
const titleBaseStyles =
  'font-semibold leading-[var(--lh-row-title)] tracking-[var(--tracking-row-title)]';

const titleSizeStyles = 'text-[length:var(--fs-row-title)]';

/** A dense row's title drops to the meta size, so a quadrant row reads as one compact block. */
const denseTitleSizeStyles = 'text-[length:var(--fs-meta)]';

/**
 * A todo row reads up to two title lines, and so does a base list row: the second line is what
 * stops a long title truncating mid-phrase. That holds for a dense row too — the press square
 * takes 24px more of the row than the pre-redesign inset did, so the column is narrow enough
 * that one line is where a quadrant title loses its ending. `--tap` is the dense row's floor,
 * not its height, so a second line grows the row instead of shrinking the target. Only the
 * nested and feedback labels stay one line: they sit above their own body, with an action
 * beside them.
 */
const titleOneLineStyles = 'truncate';
const titleTwoLineStyles = 'line-clamp-2 whitespace-normal';

/**
 * The title text inside an action line, as a real element. A text node is no flex item: the
 * line's `[&>:first-child]` rule could not reach the title, so the action kept its full width
 * and ran past the line's truncating box, cut at the clip edge with no ellipsis.
 *
 * A title that is a control rather than text — the meal entry's dish `Input` — takes the line's
 * shrink but not the truncation: `overflow: hidden` would clip the control's own focus ring
 * against the line's edge, and a control has no text to ellipsize.
 */
const actionTitleLineStyles = 'min-w-0 flex-1';

function actionTitleStylesFor(title: ReactNode): string {
  return isValidElement(title) ? actionTitleLineStyles : `${actionTitleLineStyles} truncate`;
}

/** §8's `.row__meta`: the second ink tier, one step below the title. */
const subStyles = cx(
  'flex items-baseline gap-[var(--s1)] min-w-0',
  'text-ink-2 text-[length:var(--fs-meta)] leading-[var(--lh-meta)]',
  '[&>time]:shrink-0 [&>time]:whitespace-nowrap',
  // A meta label is one token: the repeat string broke mid-label ("Custom (Fri," / "Sat)") in a
  // narrow row, so a span wraps as a whole rather than at any space inside it. A clamped snippet
  // is a paragraph, not a label, and keeps wrapping.
  '[&>span:not(.line-clamp-2)]:whitespace-nowrap',
);

/**
 * Text meta needs a box of its own. A meta *string* passed as a child of the line is an anonymous
 * flex item, and the rules above are descendant selectors: they cannot name an anonymous box, so
 * neither the nowrap nor the no-shrink reach it. A note row's `Today, 08:14 · garden` therefore
 * shrank to its narrowest column and stacked a word per line beside the body it was squeezing.
 * This box carries those same two rules, so a plain string reads exactly like the element meta
 * next to it and the note body keeps one line.
 */
const metaStyles = 'shrink-0 whitespace-nowrap';

const separatorStyles = 'shrink-0 text-ink-3';
/** One line on a base row; two on a feedback row, whose description has no other surface. */
const snippetStyles = 'min-w-0 truncate';
const feedbackSnippetStyles = 'min-w-0 line-clamp-2';
const nestedBodyStyles = 'grid gap-[var(--s2)]';

/**
 * A nested body spans its column, but a title line carrying an action gives that action a
 * full tap target plus the action-line gap, so the body reserves the same column and a child
 * field shares the title field's edges.
 */
const nestedBodyActionInsetStyles = 'pr-[calc(var(--tap)+var(--s2))]';

/** The title line carrying its action: the action sits against the title, not the child body. */
const actionLineStyles = 'flex items-stretch gap-[var(--s2)]';

/** The action keeps the line's height and never sets one of its own. */
const actionStyles = 'flex items-center shrink-0';

/**
 * A linked feedback row's outline: the result of lifting its child body out of the link. See
 * `linkNodeFor`. A column, so the link and the children beneath it fill the row's width and sit
 * one `--s2` step apart — the gap `linkColumnStyles` gives the unlinked shape, which the split
 * into two boxes lost. The gap lives here, not on the child body: that body is shared with the
 * nested variant, whose `nestedBodyStyles` owns its own spacing.
 */
const bodyColumnStyles = cx('flex w-full flex-col gap-[var(--s2)]');

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
  href: string | undefined;
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

function titleFlowStylesFor({ variant }: Readonly<RowFlags>): string {
  if (variant === 'nested' || variant === 'feedback') return titleOneLineStyles;
  return titleTwoLineStyles;
}

function titleNodeFor(
  flags: Readonly<RowFlags>,
  title: ReactNode,
  titleAction: ReactNode,
): ReactNode {
  const { isDense, done, carriesAction } = flags;
  return (
    <span
      className={cx(
        'ui-list-item__title',
        carriesAction && 'ui-list-item__title--with-action',
        titleBaseStyles,
        titleSizeStylesFor(isDense),
        carriesAction ? actionLineStyles : titleFlowStylesFor(flags),
        done && doneTitleStyles,
      )}
    >
      {carriesAction ? (
        <span className={actionTitleStylesFor(title)}>{title}</span>
      ) : (
        title
      )}
      {carriesAction && (
        <span className={cx('ui-list-item__title-action', actionStyles)}>{titleAction}</span>
      )}
    </span>
  );
}

/**
 * The meta as the line can rule on it. Meta that is already an element keeps its own children as
 * the line's items — a todo row's due date, repeat and list are spaced by the line's gap, and a
 * box around them would run the three words together — so only text meta takes the box.
 */
function metaNodeFor(meta: ReactNode): ReactNode {
  if (meta == null || isValidElement(meta)) return meta;
  return <span className={cx('ui-list-item__meta', metaStyles)}>{meta}</span>;
}

function subNodeFor(
  { variant }: Readonly<RowFlags>,
  meta: ReactNode,
  snippet: ReactNode,
): ReactNode {
  const snippetNode = snippet != null && snippet !== false && (
    <span
      className={cx(
        'ui-list-item__snippet',
        variant === 'feedback' ? feedbackSnippetStyles : snippetStyles,
      )}
    >
      {snippet}
    </span>
  );

  /* The base row reads meta and snippet on one line, separated by a `|`. A
     feedback row reads title, then date, then the description: the date pairs
     with the title one step beneath it, and the clamped description opens the
     next step below that pair. Each line reuses the `__sub` typography and no
     separator is needed. */
  return variant === 'feedback' ? (
    <>
      <span className={cx('ui-list-item__sub', subStyles)}>{metaNodeFor(meta)}</span>
      {snippetNode && (
        <span className={cx('ui-list-item__sub', subStyles, feedbackDescriptionStyles)}>
          {snippetNode}
        </span>
      )}
    </>
  ) : (
    <span className={cx('ui-list-item__sub', subStyles)}>
      {metaNodeFor(meta)}
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
 * top-aligns its slots so its meta line starts on the title's first line; its leading checkbox
 * is out of flow (`denseRowStyles`), so it takes no part in that alignment — the row pins the
 * target to its top corner and lifts the mark onto the title's first-line centre itself.
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

/**
 * The row's link, or its plain box when the consumer passes no `href`.
 *
 * A linked row puts its whole body inside its anchor, and a body may hold controls that are
 * illegal there: an `<a>` cannot contain interactive content, so a `<select>` inside one loses
 * its own click target and the row navigates instead of the control answering. Only a feedback
 * row has that shape today — its child body is the status dropdown — so only that shape lifts
 * the children out. The link becomes the title text and the description; the children keep their
 * own place beneath it, beside the anchor inside one block wrapper.
 *
 * The other two linked shapes keep their link unbroken, and nothing moves out of it: a todo row's
 * controls are slots beside the link, and a nested row's fields are the body it edits, so
 * escaping the anchor would cost it the whole-row tap target.
 */
function linkNodeFor(
  { href, variant }: Readonly<RowFlags>,
  linkStyles: string,
  text: ReactNode,
  childBody: ReactNode,
): ReactNode {
  if (variant === 'feedback') {
    if (href == null) {
      return (
        <span className={cx('ui-list-item__link', linkStyles)}>
          {text}
          {childBody}
        </span>
      );
    }
    return (
      <div className={bodyColumnStyles}>
        <Link href={href} className={cx('ui-list-item__link', linkStyles)}>
          {text}
        </Link>
        {childBody}
      </div>
    );
  }

  const body = (
    <>
      {text}
      {childBody}
    </>
  );
  const linkClasses = cx('ui-list-item__link', linkStyles);
  return href == null ? (
    <span className={linkClasses}>{body}</span>
  ) : (
    <Link href={href} className={linkClasses}>
      {body}
    </Link>
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
    href,
    variant,
    isDense: variant === 'todo' && size === 'dense',
    isColumn: variant === 'nested' || variant === 'feedback',
    hasSlot: trailing != null || deleteAction != null,
    carriesAction: (variant === 'nested' || variant === 'feedback') && titleAction != null,
    done,
    collapsing,
    tone,
  };

  const text = (
    <span className={cx('ui-list-item__text', textStyles)}>
      {titleNodeFor(flags, title, titleAction)}
      {subNodeFor(flags, meta, snippet)}
    </span>
  );

  const childBody = variant === 'nested' ? (
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
  );

  return (
    <li className={cx(rowHookClassesFor(flags), rowStyleClassesFor(flags), className)} {...rest}>
      {leading}
      {linkNodeFor(flags, linkStylesFor(flags), text, childBody)}
      {trailing}
      {deleteAction}
    </li>
  );
}
