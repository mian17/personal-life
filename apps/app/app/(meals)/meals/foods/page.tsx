import { format } from '@life/nutrition';
import { PreservingSearchBox } from '@life/app-kit';
import { EmptyState, FabLink, List, ListItem, ManagerBlock } from '@life/ui';
import { listMealFoods, type MealFood } from '@/lib/meal-api';
import { Plus } from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * The food catalog (`SPEC-food-catalog-ui`): the owner's foods, filtered by the
 * `q` the search box writes into the URL. The filter runs in the service after
 * the cache hit, so the page only forwards the query — it never filters a page
 * of rows it already holds.
 */
export default async function FoodsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ q?: string }>;
}>) {
  const { q } = await searchParams;
  const foods = await listMealFoods(q);

  return (
    <ManagerBlock title="Foods" backHref="/meals/settings">
      <PreservingSearchBox path="/meals/foods" q={q} label="Search foods" />
      <FoodList foods={foods} query={q} />
      <FabLink href="/meals/foods/new" label="New food">
        <Plus size={28} strokeWidth={2.5} aria-hidden />
      </FabLink>
    </ManagerBlock>
  );
}

/** One row: the per-100 facts a staple is logged from, never a log-time amount. */
function FoodList({ foods, query }: Readonly<{ foods: MealFood[]; query?: string }>) {
  if (foods.length === 0) return <FoodListEmpty query={query} />;

  return (
    <List>
      {foods.map((food) => (
        <ListItem
          key={food.id}
          href={`/meals/foods/${food.id}`}
          title={food.name}
          meta={`per 100 ${food.unit} · ${format('calories', food.nutrients.calories)}`}
        />
      ))}
    </List>
  );
}

/** An empty search says so; an empty catalog invites the first food. */
function FoodListEmpty({ query }: Readonly<{ query?: string }>) {
  if (query) return <EmptyState heading="No matches." body="No food name contains that text." />;

  return <EmptyState heading="No foods yet." body="Foods you add are saved here to log in one tap." />;
}
