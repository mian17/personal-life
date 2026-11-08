import { PreservingSearchBox } from '@life/app-kit';
import { Section } from '@life/ui';
import type { ListPage } from '@life/shared';
import { fetchListPage } from '@/lib/todo-api';
import { ListManagerPanel } from './list-manager-panel';

/**
 * Server wrapper for the `ListManager`, fetching todo-service lists.
 *
 * Page 1 is read here so the screen opens on the rows it always did; the cursor
 * and every later page belong to `ListManagerPanel`, the one client island. The
 * search box stays outside it, so it does not re-render when a page arrives.
 */
export async function ListManagerSection({
  path,
  q,
}: Readonly<{
  /** Route the search box replaces, so a filter change lands on this screen's URL. */
  path: string;
  /** The `q` search param, written by the search box and forwarded to the service. */
  q?: string;
}>) {
  const { lists, nextCursor } = await fetchListPage({ q });

  /**
   * The page after `cursor` for the same `q`. A server action, so the browser asks
   * for lists and the owner's token never leaves the server.
   */
  async function loadPage(cursor: string): Promise<ListPage> {
    'use server';
    return fetchListPage({ q, cursor });
  }

  return (
    <>
      <PreservingSearchBox path={path} q={q} label="Search lists" />
      {/* The search box owns the step above it and none below, so the body takes its
          rhythm from an unlabelled section — the same way `/meals/foods` opens. */}
      <Section>
        {/* A changed query mounts a fresh manager: the old cursor belongs to the old
            result set, so it must never continue this one's pages. */}
        <ListManagerPanel
          key={q ?? ''}
          lists={lists}
          nextCursor={nextCursor}
          isFiltered={Boolean(q?.trim())}
          loadPage={loadPage}
        />
      </Section>
    </>
  );
}
