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
  /** Trailing nav actions: icon links + `ThemeToggle`, in render order. */
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

/**
 * A page with no `FabLink` has no fab to clear, so its bottom padding is the screen edge
 * alone — `PageShell`'s `--space-5` band would otherwise float the content above the safe
 * area. Important because both paddings are utilities of one layer, where the later one in
 * the generated sheet wins regardless of attribute order.
 */
const fablessPageStyles = 'pb-[calc(var(--space-1)+env(safe-area-inset-bottom))]!';

export function ListShell({
  title,
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
      <NavBar trailing={navTrailing} />
      <PageTitle>{title}</PageTitle>
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
