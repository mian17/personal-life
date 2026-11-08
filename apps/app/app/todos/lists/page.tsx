import { ManagerBlock } from '@life/ui';
import { ListManagerSection } from '../../list-manager-section';

export const dynamic = 'force-dynamic';

/**
 * The lists manager, filtered by the `q` the search box writes into the URL — the
 * same convention `/notes` and `/meals/foods` use, so a filtered view is shareable
 * and survives a reload.
 */
export default async function ListsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ q?: string }>;
}>) {
  const { q } = await searchParams;

  return (
    <ManagerBlock title="Lists" backHref="/todos/settings">
      <ListManagerSection path="/todos/lists" q={q} />
    </ManagerBlock>
  );
}
