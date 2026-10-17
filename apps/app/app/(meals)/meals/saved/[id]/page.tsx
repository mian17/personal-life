import { format, sum } from '@life/nutrition';
import { Button, Card, IconLink, List, ListItem, NavBar, PageShell, PageTitle, Section } from '@life/ui';
import { ArrowLeft } from 'lucide-react';
import { loadOrNotFound } from '@life/app-kit';
import { getSavedMeal, listMealFoodsIncludingDeleted, restoredFoodName } from '@/lib/meal-api';
import { relogMealAction } from '../../actions';

export const dynamic = 'force-dynamic';

/**
 * One saved meal and its one-tap re-log (`docs/intent/meal-nutrition.md`:
 * "re-logged in one tap ... with the corrected numbers — not re-guessed").
 *
 * The items render from the **stored** snapshot: each calorie figure is that
 * item's frozen vector, never a re-derivation. The re-log control is a plain
 * server-action form — no client JS, no photo path — so one tap posts the
 * frozen numbers as a diary entry. Composition is `@life/ui` only (Contract 1).
 */
export default async function SavedMealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const meal = await loadOrNotFound(() => getSavedMeal(id));
  // Name resolution reads the whole catalog (soft-deleted rows included): the
  // item's dish name must survive the food being deleted (AC5).
  const catalog = await listMealFoodsIncludingDeleted();
  const total = format('calories', sum(meal.items.map((item) => item.nutrients)).calories);

  return (
    <PageShell>
      <NavBar
        leading={
          <IconLink href="/meals/saved" label="Back">
            <ArrowLeft size={20} aria-hidden />
          </IconLink>
        }
      />
      <PageTitle>{meal.name}</PageTitle>
      <Card>Re-log {total} in one tap — the corrected numbers, not a new guess.</Card>
      <Section label="Items">
        <List>
          {meal.items.map((item) => (
            <ListItem
              key={item.id}
              // The same catalog join the entry page does, over a catalog read
              // that includes soft-deleted foods: an item whose food the owner
              // has since deleted still shows the dish name. An id matching no
              // row — active or deleted — is a pre-feature value shown as
              // stored; null means the item was saved without a catalog food,
              // so the meal name labels it.
              title={item.foodId ? restoredFoodName(item.foodId, catalog) : meal.name}
              meta={`× ${item.quantity} · ${format('calories', item.nutrients.calories)}`}
            />
          ))}
        </List>
      </Section>
      <form action={relogMealAction.bind(null, meal.id)}>
        <Button type="submit">Log this meal again</Button>
      </form>
    </PageShell>
  );
}
