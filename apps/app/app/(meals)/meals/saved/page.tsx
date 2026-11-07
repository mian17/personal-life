import { format, sum } from '@life/nutrition';
import { Button, EmptyState, List, ListItem, ManagerBlock } from '@life/ui';
import { Trash2 } from 'lucide-react';
import { collectSavedMeals } from '@/lib/meal-api';
import { deleteSavedMealAction } from './actions';

export const dynamic = 'force-dynamic';

/**
 * The saved-meals list (`SPEC-meal-capture-ui` project structure). Every row is
 * one frozen meal linking to its own detail route; the calorie figure is the
 * sum of the **stored** item vectors, never a fresh derivation. Composition is
 * `@life/ui` only (Contract 1 Rule 1): `ManagerBlock` frames it,
 * `List`/`ListItem` render the rows, `EmptyState` covers none saved.
 */
export default async function SavedMealsPage() {
  // No load-more control yet, so the screen walks the cursor to completion: the
  // browsable saved-meal history is exactly what this list is for.
  const saved = await collectSavedMeals();

  return (
    <ManagerBlock title="Saved meals" backHref="/meals/settings">
      {saved.length === 0 ? (
        <EmptyState body="No saved meals yet. Correct a meal and save it to re-log it in one tap." />
      ) : (
        <List>
          {saved.map((meal) => (
            <ListItem
              key={meal.id}
              href={`/meals/saved/${meal.id}`}
              title={meal.name}
              meta={format('calories', sum(meal.items.map((item) => item.nutrients)).calories)}
              deleteAction={
                <form action={deleteSavedMealAction.bind(null, meal.id)}>
                  <Button
                    type="submit"
                    variant="danger"
                    size="icon"
                    aria-label={`Delete ${meal.name}`}
                  >
                    <Trash2 size={18} aria-hidden />
                  </Button>
                </form>
              }
            />
          ))}
        </List>
      )}
    </ManagerBlock>
  );
}
