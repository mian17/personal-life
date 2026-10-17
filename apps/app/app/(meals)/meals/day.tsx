import { format, sum } from '@life/nutrition';
import {
  ButtonLink,
  Card,
  EmptyState,
  formatDate,
  List,
  ListItem,
  NavBar,
  PageShell,
  PageTitle,
  Section,
  Stack,
  StatusText,
} from '@life/ui';
import { MealDoors } from './meal-doors';
import { MealsNav } from '../../meals-nav';
import { ApiError } from '@/lib/api-error';
import {
  getMealTarget,
  listDayEntries,
  listMealFoodsIncludingDeleted,
  restoredFoodName,
  type MealEntry,
} from '@/lib/meal-api';

/**
 * The shared meals day view. It lives in a plain module — NOT a Next `page`
 * file — because a `page.tsx` may only export a Page (`default`), route
 * metadata, and a small allow-list; exporting `mealDay` from `page.tsx` fails
 * `next build` ("not a valid Page export field"). Both day routes import it
 * from here, so their structure and spacing can never drift (lessons 0016 +
 * 0006). `day` is the client's resolved `YYYY-MM-DD` (lesson 0019), never
 * derived inside the view.
 */

/** The four meal groups in display order (spec: day view). */
const GROUPS: { key: MealEntry['mealGroup']; label: string }[] = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snack', label: 'Snacks' },
];

/**
 * The day's headline: total eaten against the target and what remains. A missing
 * profile (target 404) is "no target set", never an error page; an over-target
 * day reads "X over" so the shared formatter's negative guard never leaks an
 * em dash into the remaining figure.
 */
function daySummary(totalCalories: number, target: { calories: number } | null): string {
  const eaten = format('calories', totalCalories);
  if (target == null) return `${eaten} — No target set`;
  const rest = target.calories - totalCalories;
  const tail =
    rest >= 0 ? `${format('calories', rest)} left` : `${format('calories', -rest)} over`;
  return `${eaten} / ${format('calories', target.calories)}, ${tail}`;
}

/** The target row, or `null` when the owner has no profile yet (404). */
async function loadTarget(date: string) {
  try {
    return await getMealTarget(date);
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * The one meals day view: total vs target, entries grouped by meal, and the
 * photo FAB front door into the editor (saved meals live in the toolbar nav).
 * The whole-page block both day routes render.
 *
 * Nutrient strings come from the shared `@life/nutrition` formatter and totals
 * from its `sum()` (no app-local unit table); the upload atom itself lives on
 * the entry editor — the photo door opens it, it is not composed here.
 */
export async function mealDay(day: string, emptyBody: string) {
  const [entries, target, catalog] = await Promise.all([
    listDayEntries(day),
    loadTarget(day),
    listMealFoodsIncludingDeleted(),
  ]);
  const totalCalories = sum(entries.map((entry) => entry.nutrients)).calories;

  return (
    <PageShell>
      <NavBar trailing={<MealsNav />} />
      <PageTitle>Meals — {formatDate(day)}</PageTitle>
      <Card>
        <Stack gap="sm">
          <StatusText>{daySummary(totalCalories, target)}</StatusText>
          <ButtonLink href="/meals/target" variant="ghost">
            {target ? 'Edit target' : 'Set target'}
          </ButtonLink>
        </Stack>
      </Card>
      {entries.length === 0 ? (
        <EmptyState body={emptyBody} />
      ) : (
        GROUPS.map((group) => {
          const items = entries.filter((entry) => entry.mealGroup === group.key);
          if (items.length === 0) return null;
          const subtotal = format(
            'calories',
            sum(items.map((entry) => entry.nutrients)).calories,
          );
          return (
            <Section key={group.key} label={`${group.label} — ${subtotal}`}>
              <List>
                {items.map((entry) => {
                  // The catalog resolves the stored id to a name; an id matching
                  // no row — active or deleted — is a pre-feature entry whose
                  // stored value is itself the dish (restoredFoodName). The read
                  // includes soft-deleted foods, so a food deleted after logging
                  // still names the entry it was logged as.
                  // Blank (only a caller bypassing the editor's non-empty rule)
                  // falls back to the old calories-title row, never blank.
                  const label = restoredFoodName(entry.foodId, catalog).trim();
                  const calories = format('calories', entry.nutrients.calories);
                  return (
                    <ListItem
                      key={entry.id}
                      title={label || calories}
                      meta={label ? `${calories} × ${entry.quantity}` : `× ${entry.quantity}`}
                    />
                  );
                })}
              </List>
            </Section>
          );
        })
      )}
      <MealDoors />
    </PageShell>
  );
}
