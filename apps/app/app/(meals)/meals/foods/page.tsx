import { format } from '@life/nutrition';
import { PreservingSearchBox } from '@life/app-kit';
import { FabLink, ManagerBlock, Section } from '@life/ui';
import { listMealFoods } from '@/lib/meal-api';
import { Plus } from 'lucide-react';
import { FoodCatalog, type CatalogPage, type CatalogRow } from './food-catalog';

export const dynamic = 'force-dynamic';

/** One catalog row as the client shell receives it: `@life/nutrition` formats it here. */
function catalogRow(food: { id: string; name: string; unit: string; nutrients: { calories: number } }): CatalogRow {
  return {
    id: food.id,
    name: food.name,
    meta: `per 100 ${food.unit} · ${format('calories', food.nutrients.calories)}`,
  };
}

/**
 * The food catalog (`SPEC-food-catalog-ui`, `SPEC-load-more`): the owner's foods,
 * filtered by the `q` the search box writes into the URL. The filter runs in the service
 * after the cache hit, so the page only forwards the query — it never filters a page of
 * rows it already holds.
 *
 * Page 1 is read here so the screen opens on the rows it always did; the cursor and
 * every later page belong to `FoodCatalog`, the one client island. The search box and
 * the fab stay outside it, so neither re-renders when a page arrives.
 */
export default async function FoodsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ q?: string }>;
}>) {
  const { q } = await searchParams;
  const { foods, nextCursor } = await listMealFoods(q);

  /**
   * The page after `cursor` for the same `q`, rows formatted before they cross to the
   * client. A server action, so the browser asks for foods and the owner's token never
   * leaves the server.
   */
  async function loadPage(query: string | undefined, cursor: string): Promise<CatalogPage> {
    'use server';
    const page = await listMealFoods(query, cursor);
    return { rows: page.foods.map(catalogRow), nextCursor: page.nextCursor };
  }

  return (
    <ManagerBlock title="Foods" backHref="/meals/settings">
      <PreservingSearchBox path="/meals/foods" q={q} label="Search foods" />
      {/* The search box owns the step above it and none below, so the body takes its
          rhythm from an unlabelled section — the same way `/todos` opens below its tabs. */}
      <Section>
        {/* A changed query mounts a fresh catalog: the old cursor belongs to the old
            result set, so it must not continue this one's pages. */}
        <FoodCatalog
          key={q ?? ''}
          rows={foods.map(catalogRow)}
          nextCursor={nextCursor}
          query={q}
          loadPage={loadPage}
        />
      </Section>
      <FabLink href="/meals/foods/new" label="New food">
        <Plus size={28} strokeWidth={2.5} aria-hidden />
      </FabLink>
    </ManagerBlock>
  );
}
