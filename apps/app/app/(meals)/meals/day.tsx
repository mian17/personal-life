import { format, sum, UNKNOWN, type Nutrient, type NutrientVector } from '@life/nutrition';
import {
  ButtonLink,
  Card,
  EmptyState,
  formatDate,
  Kpi,
  List,
  ListItem,
  NavBar,
  PageShell,
  PageTitle,
  Pill,
  ProgressBar,
  Section,
  Stack,
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
  type MealTarget,
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

/** The reference's three macro tracks, in its order; the goal grams live on the target row. */
const MACRO_TRACKS: readonly {
  key: Nutrient;
  label: string;
  /** The nutrient as the reference's track aria-label names it (`62 grams of carbohydrate toward 220`). */
  noun: string;
  goal: (target: MealTarget) => number;
}[] = [
  { key: 'protein', label: 'Protein', noun: 'protein', goal: (target) => target.proteinG },
  { key: 'carbohydrates', label: 'Carbs', noun: 'carbohydrate', goal: (target) => target.carbG },
  { key: 'fat', label: 'Fat', noun: 'fat', goal: (target) => target.fatG },
];

/** Whole kcal with the reference's thousands separator (`1,180`); the formatter does not group. */
const KCAL = new Intl.NumberFormat('en-US');

function grouped(kcal: number): string {
  return KCAL.format(Math.round(kcal));
}

/**
 * The day's headline as `Kpi`'s two slots: the eaten figure on its own (whole
 * kcal, grouped the way the reference draws it), then what it is measured
 * against — `of 2,050 kcal`, the unit word last as the reference writes it. A
 * missing profile (target 404) is "no target set", never an error page.
 */
function dayReadout(
  totalCalories: number,
  target: { calories: number } | null,
): { eaten: string; unit: string } {
  const eaten =
    Number.isFinite(totalCalories) && totalCalories >= 0 ? grouped(totalCalories) : UNKNOWN;
  if (target == null) return { eaten, unit: 'kcal — No target set' };
  return { eaten, unit: `of ${grouped(target.calories)} kcal` };
}

/** A figure as a share of its goal; a zero or unknown goal draws an empty bar, never a divide-by-zero. */
function percentOf(have: number, goal: number): number {
  if (!Number.isFinite(have) || !Number.isFinite(goal) || goal <= 0) return 0;
  return (have / goal) * 100;
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
 *
 * The headline card is the reference's progress card: the day's `Kpi`, one
 * energy track against the target calories, then the three macro tracks. The
 * card IS the read-out, so it carries the one `role="status"` the day view
 * exposes — a `Kpi` is block content and cannot nest inside a phrasing
 * `StatusText`.
 */
export async function mealDay(day: string, emptyBody: string) {
  const [entries, target, catalog] = await Promise.all([
    listDayEntries(day),
    loadTarget(day),
    listMealFoodsIncludingDeleted(),
  ]);
  const totals: NutrientVector = sum(entries.map((entry) => entry.nutrients));
  const readout = dayReadout(totals.calories, target);
  const energyPercent = target == null ? 0 : percentOf(totals.calories, target.calories);

  return (
    <PageShell>
      <NavBar trailing={<MealsNav />} />
      <PageTitle>Meals — {formatDate(day)}</PageTitle>
      <Card aria-live="polite" role="status">
        <Stack gap="sm">
          <Kpi label="Logged so far" value={readout.eaten} unit={readout.unit} />
          {target != null && (
            <>
              <ProgressBar
                value={energyPercent}
                label={`${Math.round(energyPercent)} percent of the daily energy target`}
              />
              {MACRO_TRACKS.map((track) => {
                const goal = track.goal(target);
                const have = totals[track.key];
                return (
                  <ProgressBar
                    key={track.key}
                    value={percentOf(have, goal)}
                    label={`${Math.round(have)} grams of ${track.noun} toward ${Math.round(goal)}`}
                    caption={track.label}
                    readout={`${Math.round(have)} / ${format(track.key, goal)}`}
                  />
                );
              })}
            </>
          )}
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
            <Section key={group.key} label={group.label} count={subtotal}>
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
                      meta={`× ${entry.quantity}`}
                      trailing={label ? <Pill>{calories}</Pill> : undefined}
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
