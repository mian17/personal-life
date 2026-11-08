import { ManagerBlock } from '@life/ui';
import { TagManagerSection } from '../../tag-manager-section';

export const dynamic = 'force-dynamic';

/**
 * The tag manager, filtered by the `q` the search box writes into the URL — the
 * same convention `/notes` and `/meals/foods` use, so a filtered view is shareable
 * and survives a reload.
 *
 * The rows come from the **tags registry**, not from note-service's tag-usage
 * surface: the usage endpoint stores tag ids and counts only and honors no `q`
 * (note-service cannot resolve names), so a filter there could only ever be a
 * client-side narrowing of whatever page happened to be loaded. The registry is
 * the vocabulary this screen manages, it pages, and its page honors `q` — so this
 * screen filters server-side over the thing it actually renames and deletes.
 */
export default async function TagsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ q?: string }>;
}>) {
  const { q } = await searchParams;

  return (
    <ManagerBlock title="Tags" backHref="/notes/settings">
      <TagManagerSection path="/notes/tags" q={q} />
    </ManagerBlock>
  );
}
