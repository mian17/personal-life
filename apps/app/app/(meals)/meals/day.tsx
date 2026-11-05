import { format, sum, UNKNOWN, type Nutrient, type NutrientVector } from '@life/nutrition';
import {
  ButtonLink,
  Card,
  EmptyState,
  formatLongDate,
  Kpi,
  List,
  ListItem,
  ListShell,
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
  type MealFood,
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

/**
 * A group with nothing logged keeps its heading, so the day always shows the four meals it is
 * made of: the count slot reads the literal `Not logged` where a group with entries reads its
 * subtotal, and the group's box carries this copy instead of a list.
 */
const EMPTY_GROUP_COUNT = 'Not logged';
const EMPTY_GROUP_BODY = 'No meals logged in this meal yet.';
const EMPTY_GROUP_HEADING = 'Nothing yet.';

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
 * The one meals day view: the page header (`ListShell`, the same block notes and
 * todos render), total vs target, entries grouped by meal, and the log FAB front
 * door into the editor. The whole-page block both day routes render.
 *
 * The day keeps every group on screen even when nothing is logged in it, so an
 * empty day reads as four meals to fill rather than one blank page; only when no
 * group has an entry does the single whole-body empty state stand in for all four.
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
  const energyPercent = percentOf(totals.calories, target?.calories ?? 0);

  return (
    <ListShell
      title="Meals"
      subtitle={formatLongDate(day)}
      navTrailing={<MealsNav />}
      // The log menu is the page's own fixed control rather than a `FabLink`, so
      // the shell is told to keep the fab band and the last row clears it.
      fabBand
      body={
        <>
          {/* Label-less sections: `Section` owns the page's one block step (`--s6`), so the
              card opens below the header and the empty box below the card like every other
              block on the page. */}
          <Section>
            <Card aria-live="polite" role="status">
              <Stack gap="sm">
                <Kpi label="Logged so far" value={readout.eaten} unit={readout.unit} />
                {/* The tracks are the card's shape, not a target's: with no profile the
                    fill stays empty and the bars still say what was eaten, only against
                    no goal. */}
                <ProgressBar
                  tone="line"
                  value={energyPercent}
                  label={
                    target == null
                      ? 'No daily energy target set'
                      : `${Math.round(energyPercent)} percent of the daily energy target`
                  }
                  className="mt-[var(--s3)]"
                />
                {MACRO_TRACKS.map(({ key, label, noun, goal }) => {
                  const have = totals[key];
                  const targetGoal = target == null ? null : goal(target);
                  return (
                    <ProgressBar
                      key={key}
                      tone="line"
                      value={percentOf(have, targetGoal ?? 0)}
                      label={
                        targetGoal == null
                          ? `${Math.round(have)} grams of ${noun} — no target set`
                          : `${Math.round(have)} grams of ${noun} toward ${Math.round(targetGoal)}`
                      }
                      caption={label}
                      // A logged amount with no goal to divide it by reads as the grams
                      // alone; `0 / 0 g` would claim a target the owner never set.
                      readout={
                        targetGoal == null
                          ? format(key, have)
                          : `${Math.round(have)} / ${format(key, targetGoal)}`
                      }
                      className="mt-[var(--s3)]"
                    />
                  );
                })}
                <ButtonLink href="/meals/target" variant="ghost">
                  {target ? 'Edit target' : 'Set target'}
                </ButtonLink>
              </Stack>
            </Card>
          </Section>
          {entries.length === 0 ? (
            <Section>
              <EmptyState body={emptyBody} />
            </Section>
          ) : (
            GROUPS.map((group) => (
              <MealGroup
                key={group.key}
                group={group}
                items={entries.filter((entry) => entry.mealGroup === group.key)}
                catalog={catalog}
              />
            ))
          )}
          <MealDoors />
        </>
      }
    />
  );
}

/**
 * One meal of the day: its heading with the subtotal (or `Not logged`), then either the rows
 * that were logged in it or the group's own empty box.
 */
function MealGroup({
  group,
  items,
  catalog,
}: Readonly<{
  group: { key: MealEntry['mealGroup']; label: string };
  items: MealEntry[];
  catalog: MealFood[];
}>) {
  const subtotal =
    items.length === 0
      ? EMPTY_GROUP_COUNT
      : format('calories', sum(items.map((entry) => entry.nutrients)).calories);

  return (
    <Section label={group.label} count={subtotal}>
      {items.length === 0 ? (
        <EmptyState heading={EMPTY_GROUP_HEADING} body={EMPTY_GROUP_BODY} />
      ) : (
        <List>
          {items.map((entry) => {
            // The catalog resolves the stored id to a name; an id matching no
            // row — active or deleted — is a pre-feature entry whose stored
            // value is itself the dish (restoredFoodName). The read includes
            // soft-deleted foods, so a food deleted after logging still names
            // the entry it was logged as. Blank (only a caller bypassing the
            // editor's non-empty rule) falls back to the calories-title row.
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
      )}
    </Section>
  );
}
