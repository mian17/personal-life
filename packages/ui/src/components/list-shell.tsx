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
   * Reserve the fab band although no `FabLink` renders: for a page whose fab is its own fixed
   * control (e.g. `FabMenu`), so the last row does not scroll under it. Ignored when `fabHref`
   * is set, since the rendered `FabLink` already reserves the band. Off by default.
   */
  fabBand?: boolean;
  /**
   * Where the header row lines up: `start` opens the title on its own top edge, as every list page
   * draws it; `center` levels the row on its middle, which is the design's single-line
   * `.app__header`. Default `'start'`.
   */
  headerAlign?: 'start' | 'center';
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
 * it. A definite `100dvh` page is what bounds it. Its top inset is the section step (`--s6`), the
 * same gap a labelled `Section` opens with, so a filled body starts below the tabs like the list.
 */
const fillBodyStyles = 'flex-1 min-h-0 grid pt-[var(--s6)] [grid-template-rows:minmax(0,1fr)]';

/**
 * §8's `.phead__sub`: one step under the meta tier, in the second ink tier, under the title.
 * The `--s2` step (`--s1` before) is the whole title → sub-line gap. A 28px bold title followed by
 * only 4px read as the date crowding the heading, so the gap takes the next spacing step up; 8px
 * keeps the date attached to its title as one header block rather than floating it free.
 */
const subtitleStyles = cx(
  'ui-list-shell__sub',
  'mt-[var(--s2)] text-[length:var(--fs-meta)] leading-[var(--lh-meta)] text-ink-2',
);

/**
 * §8's `.phead` puts the title block and the trailing controls on one flex line; `NavBar`'s own
 * `pt-[var(--s2)]` is that line's top inset, so the title drops its own top margin (`mt-0`). The
 * heading's own bottom step is dropped too (`mb-0`), leaving `subtitleStyles`' `--s2` as the whole
 * title → sub-line gap — the sub-line's own step, not the two steps compounded. Dropping the
 * heading's margin is deliberate: one step owns the gap, so it is tuned in one place.
 */
const titleBlockStyles = 'mt-0 mb-0';

/**
 * The header's leading slot: the title block — `<h1>` plus the optional sub-line — level with
 * the trailing controls, matching `.phead`'s `<div>` wrapper. The page title takes the design's
 * `--fw-semibold` (`.phead__title` in both drawn previews) instead of the atom's `bold` default,
 * which stays where it is for every other `PageTitle` caller.
 */
function TitleBlock({ title, subtitle }: Readonly<Pick<ListShellProps, 'title' | 'subtitle'>>) {
  return (
    <div className="ui-list-shell__title-block">
      <PageTitle className={titleBlockStyles} weight="semibold">
        {title}
      </PageTitle>
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

/**
 * The fab band `PageShell` draws, restated with `!` for a page that keeps `PageShell`'s band but
 * supplies its own fixed fab control (`fabBand`), so the last row clears it.
 */
const fabBandPageStyles = 'pb-[calc(var(--fab-size)+var(--s8)+env(safe-area-inset-bottom))]!';

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
  fabBand,
  headerAlign,
  fill,
}: Readonly<ListShellProps>): JSX.Element {
  return (
    <PageShell
      className={cx(
        fill && cx('ui-list-shell--fill', fillPageStyles),
        fabHref == null && (fabBand ? fabBandPageStyles : fablessPageStyles),
      )}
    >
      <NavBar
        align={headerAlign}
        leading={<TitleBlock title={title} subtitle={subtitle} />}
        trailing={navTrailing}
      />
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
