import { ArrowLeft } from 'lucide-react';
// React 19 types dropped the global `JSX` namespace; it is exported by `react`.
import type { JSX, ReactNode } from 'react';
import { IconLink } from './icon-link';
import { NavBar } from './nav-bar';
import { PageShell } from './page-shell';
import { PageTitle } from './page-title';

export interface ManagerBlockProps {
  /** Page title rendered as `<h1>` (`PageTitle`). Frozen text, e.g. "Tags"/"Lists". */
  title: string;
  /** Back target (`IconLink` href). */
  backHref: string;
  /** Back control aria-label; default `"Back"` (frozen). */
  backLabel?: string;
  /**
   * `PageTitle`'s `sub` passthrough: one quiet line under the heading, for a sub-view whose
   * sub-line the server computed. Omitted, the heading renders alone.
   */
  sub?: ReactNode;
  /** Filter rows: `PillGroup` status pills and/or `TagFilterNav`, in render order. */
  filters?: ReactNode;
  /** The manager surface: an app-composed `TagManager`/`ListManager` node. */
  children: ReactNode;
}

export function ManagerBlock({
  title,
  backHref,
  backLabel = 'Back',
  sub,
  filters,
  children,
}: Readonly<ManagerBlockProps>): JSX.Element {
  return (
    <PageShell>
      <NavBar
        leading={
          <IconLink href={backHref} label={backLabel}>
            <ArrowLeft size={20} aria-hidden />
          </IconLink>
        }
      />

      <PageTitle sub={sub}>{title}</PageTitle>

      {filters}
      {children}
    </PageShell>
  );
}
