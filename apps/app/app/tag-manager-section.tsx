import { PreservingSearchBox } from '@life/app-kit';
import { Section } from '@life/ui';
import { fetchTagPage } from '@/lib/tags-api';
import { TagManagerPanel, type TagRowsPage } from './tag-manager-panel';

/**
 * Server wrapper that fetches the registry vocabulary and renders the shared
 * `TagManager`. Mounted on both `/notes/tags` and `/todos/tags`, backed by
 * `tags-service` exclusively — the single source of the vocabulary, and the one
 * service whose page honors `q`.
 *
 * Page 1 is read here so the screen opens on the rows it always did; the cursor
 * and every later page belong to `TagManagerPanel`, the one client island. The
 * search box stays outside it, so it does not re-render when a page arrives.
 */
export async function TagManagerSection({
  path,
  q,
}: Readonly<{
  /** Route the search box replaces, so a filter change lands on this screen's URL. */
  path: string;
  /** The `q` search param, written by the search box and forwarded to the service. */
  q?: string;
}>) {
  const { tags, nextCursor } = await fetchTagPage({ q });

  /**
   * The page after `cursor` for the same `q`. A server action, so the browser asks
   * for tags and the owner's token never leaves the server.
   */
  async function loadPage(cursor: string): Promise<TagRowsPage> {
    'use server';
    const page = await fetchTagPage({ q, cursor });
    return {
      tags: page.tags.map((tag) => ({ id: tag.id, name: tag.name })),
      nextCursor: page.nextCursor,
    };
  }

  return (
    <>
      <PreservingSearchBox path={path} q={q} label="Search tags" />
      {/* The search box owns the step above it and none below, so the body takes its
          rhythm from an unlabelled section — the same way `/meals/foods` opens. */}
      <Section>
        {/* A changed query mounts a fresh manager: the old cursor belongs to the old
            result set, so it must never continue this one's pages. */}
        <TagManagerPanel
          key={q ?? ''}
          tags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
          nextCursor={nextCursor}
          isFiltered={Boolean(q?.trim())}
          loadPage={loadPage}
        />
      </Section>
    </>
  );
}
