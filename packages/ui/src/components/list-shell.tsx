// React 19 types dropped the global `JSX` namespace; it is exported by `react`.
import type { JSX, ReactNode } from 'react';
import { cx } from '../lib/cx';
import { FabLink } from './fab-link';
import { NavBar } from './nav-bar';
import { PageShell } from './page-shell';
import { PageTitle } from './page-title';

export interface ListShellProps {
  /** Page title rendered as `<h1>` (`PageTitle`). Frozen text supplied by the app. */
  title: string;
  /** §8's `.phead__sub`: the one quiet line under the title (e.g. "Across all five modules"). */
  subtitle?: string;
  /** Trailing nav actions: icon links, in render order. */
  navTrailing?: ReactNode;
  /** Tab navigation (`TabBar`); rendered directly under the page title. */
  tabs?: ReactNode;
  /** The param-preserving search box (app-kit's `SearchField` wrapper). */
  search?: ReactNode;
  /** Filter rows: `PillGroup` status pills and/or `TagFilterNav`, in render order. */
  filters?: ReactNode;
  /** Empty-state OR list body. The app decides which it passes. */
  body: ReactNode;
  /** Fixed action button `FabLink` href (supplied by the app). Omit all three `fab*` props and no `FabLink` renders (a page with no create action). */
  fabHref?: string;
  /** Fab aria-label; frozen visible/accessible text supplied by the app. */
  fabLabel?: string;
  /** Fab icon node (e.g. `<Plus size={28} strokeWidth={2.5} aria-hidden />`). */
  fabIcon?: ReactNode;
  /**
   * Opt into a full-viewport-height page: the `body` slot grows to fill the
   * remaining space, for a full-height body such as the matrix. Off by default,
   * so other pages are unchanged.
   */
  fill?: boolean;
}

/**
 * Opt-in full-height page: the page column spans the viewport and the body slot grows to fill
 * the rest, so a full-height child (e.g. the matrix) spans the screen. The page's bottom padding
 * still reserves room for the fixed fab.
 */
const fillPageStyles = 'flex flex-col h-[100dvh] overflow-hidden';

/**
 * The growing slot between the page title block and the fab. `minmax(0, 1fr)`, not a bare `1fr`:
 * `1fr` is `minmax(auto, 1fr)`, so a tall child would grow this track instead of scrolling inside
 * it. A definite `100dvh` page is what bounds it.
 */
const fillBodyStyles = 'flex-1 min-h-0 grid [grid-template-rows:minmax(0,1fr)]';

/** §8's `.phead__sub`: one step under the meta tier, in the second ink tier, right under the title. */
const subtitleStyles = cx(
  'ui-list-shell__sub',
  'mt-[var(--s1)] text-[length:var(--fs-meta)] leading-[var(--lh-meta)] text-ink-2',
);

/**
 * §8's `.phead` puts the title block and the trailing controls on one flex line; `NavBar`'s own
 * `pt-[var(--s2)]` is that line's top inset, so the title drops its own top margin (`mt-0`). The
 * heading's own bottom step is dropped too (`mb-0`), leaving `subtitleStyles`' `--s1` as the whole
 * title → sub-line gap — `.phead__sub`'s `margin-top: var(--s1)`, not the two steps compounded.
 */
const titleBlockStyles = 'mt-0 mb-0';

/**
 * The header's leading slot: the title block — `<h1>` plus the optional sub-line — level with
 * the trailing controls, matching `.phead`'s `<div>` wrapper.
 */
function TitleBlock({ title, subtitle }: Pick<ListShellProps, 'title' | 'subtitle'>) {
  return (
    <div className="ui-list-shell__title-block">
      <PageTitle className={titleBlockStyles}>{title}</PageTitle>
      {subtitle != null && <p className={subtitleStyles}>{subtitle}</p>}
    </div>
  );
}

/**
 * A page with no `FabLink` has no fab to clear, so its bottom padding is the frame's own
 * `--s6` band alone — `PageShell`'s fab band would otherwise float the content above the
 * safe area. Important because both paddings are utilities of one layer, where the later
 * one in the generated sheet wins regardless of attribute order.
 */
const fablessPageStyles = 'pb-[calc(var(--s6)+env(safe-area-inset-bottom))]!';

export function ListShell({
  title,
  subtitle,
  navTrailing,
  tabs,
  search,
  filters,
  body,
  fabHref,
  fabLabel,
  fabIcon,
  fill,
}: Readonly<ListShellProps>): JSX.Element {
  return (
    <PageShell
      className={cx(
        fill && cx('ui-list-shell--fill', fillPageStyles),
        fabHref == null && fablessPageStyles,
      )}
    >
      <NavBar leading={<TitleBlock title={title} subtitle={subtitle} />} trailing={navTrailing} />
      {tabs}
      {search}
      {filters}
      {fill ? <div className={cx('ui-list-shell__body', fillBodyStyles)}>{body}</div> : body}
      {fabHref != null && (
        <FabLink href={fabHref} label={fabLabel ?? ''}>
          {fabIcon}
        </FabLink>
      )}
    </PageShell>
  );
}
