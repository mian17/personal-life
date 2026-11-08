import { ManagerBlock } from '@life/ui';
import { TagManagerSection } from '../../tag-manager-section';

export const dynamic = 'force-dynamic';

/**
 * The tag manager, filtered by the `q` the search box writes into the URL — the
 * same convention `/notes` and `/meals/foods` use, so a filtered view is shareable
 * and survives a reload.
 */
export default async function TagsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ q?: string }>;
}>) {
  const { q } = await searchParams;

  return (
    <ManagerBlock title="Tags" backHref="/todos/settings">
      <TagManagerSection path="/todos/tags" q={q} />
    </ManagerBlock>
  );
}
