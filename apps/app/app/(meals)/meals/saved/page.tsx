import { format, sum } from '@life/nutrition';
import { Button, EmptyState, IconLink, List, ListItem, NavBar, PageShell, PageTitle } from '@life/ui';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { listSavedMeals } from '@/lib/meal-api';
import { deleteSavedMealAction } from './actions';
import { MealsNav } from '../../../meals-nav';

export const dynamic = 'force-dynamic';

/**
 * The saved-meals list (`SPEC-meal-capture-ui` project structure). Every row is
 * one frozen meal linking to its own detail route; the calorie figure is the
 * sum of the **stored** item vectors, never a fresh derivation. Composition is
 * `@life/ui` only (Contract 1 Rule 1): `PageShell`/`PageTitle` frame it,
 * `List`/`ListItem` render the rows, `EmptyState` covers none saved.
 */
export default async function SavedMealsPage() {
  const saved = await listSavedMeals();

  return (
    <PageShell>
      <NavBar
        leading={
          <IconLink href="/meals" label="Back">
            <ArrowLeft size={20} aria-hidden />
          </IconLink>
        }
        trailing={<MealsNav />}
      />
      <PageTitle>Saved meals</PageTitle>
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
    </PageShell>
  );
}
