// React 19 types dropped the global `JSX` namespace; it is exported by `react`.
import type { JSX, ReactNode } from 'react';
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
  /** Fixed action button `FabLink` href (supplied by the app). */
  fabHref: string;
  /** Fab aria-label; frozen visible/accessible text supplied by the app. */
  fabLabel: string;
  /** Fab icon node (e.g. `<Plus size={28} strokeWidth={2.5} aria-hidden />`). */
  fabIcon: ReactNode;
}

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
}: ListShellProps): JSX.Element {
  return (
    <PageShell>
      <NavBar trailing={navTrailing} />
      <PageTitle>{title}</PageTitle>
      {tabs}
      {search}
      {filters}
      {body}
      <FabLink href={fabHref} label={fabLabel}>
        {fabIcon}
      </FabLink>
    </PageShell>
  );
}
