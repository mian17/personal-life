import { format, sum } from '@life/nutrition';
import { ManagerBlock } from '@life/ui';
import { listSavedMeals, type SavedMeal } from '@/lib/meal-api';
import { SavedMealsScroll, type SavedMealRow, type SavedMealRowsPage } from './saved-meals-scroll';

export const dynamic = 'force-dynamic';

/** One row as the client shell receives it: the calorie figure summed from the stored vectors. */
function savedMealRow(meal: SavedMeal): SavedMealRow {
  return {
    id: meal.id,
    name: meal.name,
    meta: format('calories', sum(meal.items.map((item) => item.nutrients)).calories),
  };
}

/**
 * The saved-meals list (`SPEC-meal-capture-ui` project structure, `SPEC-load-more`).
 * Every row is one frozen meal linking to its own detail route; the calorie figure is
 * the sum of the **stored** item vectors, never a fresh derivation.
 *
 * Page 1 is read here so the screen opens on the rows it always did; the cursor and
 * every later page belong to `SavedMealsScroll`, the one client island. Composition is
 * `@life/ui` only (Contract 1 Rule 1): `ManagerBlock` frames it, the island renders
 * `List`/`ListItem` rows and `EmptyState` covers none saved.
 */
export default async function SavedMealsPage() {
  const { savedMeals, nextCursor } = await listSavedMeals();

  /**
   * The page after `cursor`, rows formatted before they cross to the client. A server
   * action, so the owner's token never leaves the server and `@life/nutrition` stays
   * out of the browser bundle.
   */
  async function loadPage(cursor: string): Promise<SavedMealRowsPage> {
    'use server';
    const page = await listSavedMeals(cursor);
    return { rows: page.savedMeals.map(savedMealRow), nextCursor: page.nextCursor };
  }

  return (
    <ManagerBlock title="Saved meals" backHref="/meals/settings">
      <SavedMealsScroll
        rows={savedMeals.map(savedMealRow)}
        nextCursor={nextCursor}
        loadPage={loadPage}
      />
    </ManagerBlock>
  );
}
