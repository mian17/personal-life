import { format, sum } from '@life/nutrition';
import {
  Card,
  EmptyState,
  FabLink,
  formatDate,
  List,
  ListItem,
  PageShell,
  PageTitle,
  Pill,
  Row,
  Section,
  StatusText,
} from '@life/ui';
import { Camera } from 'lucide-react';
import { ApiError } from '@/lib/api-error';
import { getMealTarget, listDayEntries, type MealEntry } from '@/lib/meal-api';

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
 * three entry doors (photo FAB front door; manual + saved as pills, always all
 * available). The whole-page block both day routes render.
 *
 * Nutrient strings come from the shared `@life/nutrition` formatter and totals
 * from its `sum()` (no app-local unit table); the upload atom itself lives on
 * the entry editor — the photo door opens it, it is not composed here.
 */
export async function mealDay(day: string, emptyBody: string) {
  const [entries, target] = await Promise.all([listDayEntries(day), loadTarget(day)]);
  const totalCalories = sum(entries.map((entry) => entry.nutrients)).calories;

  return (
    <PageShell>
      <PageTitle>Meals — {formatDate(day)}</PageTitle>
      <Card>
        <StatusText>{daySummary(totalCalories, target)}</StatusText>
      </Card>
      <Row>
        <Pill as="a" href="/meals/entry/new">
          Log manually
        </Pill>
        <Pill as="a" href="/meals/saved">
          Saved meals
        </Pill>
      </Row>
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
                  // Blank dish (only a caller that bypasses the editor's non-empty
                  // rule) falls back to the old calories-title row, never blank.
                  const dish = entry.foodId.trim();
                  const calories = format('calories', entry.nutrients.calories);
                  return (
                    <ListItem
                      key={entry.id}
                      title={dish || calories}
                      meta={dish ? `${calories} × ${entry.quantity}` : `× ${entry.quantity}`}
                    />
                  );
                })}
              </List>
            </Section>
          );
        })
      )}
      <FabLink href="/meals/entry/new?door=photo" label="Log meal from photo">
        <Camera size={28} strokeWidth={2.5} aria-hidden />
      </FabLink>
    </PageShell>
  );
}
