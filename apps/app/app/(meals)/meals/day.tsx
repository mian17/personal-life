import { format, sum, UNKNOWN, type NutrientVector } from '@life/nutrition';
import {
  ButtonLink,
  Card,
  EmptyState,
  formatLongDate,
  Kpi,
  ListShell,
  ProgressBar,
  Section,
  Stack,
} from '@life/ui';
import { DayEntriesScroll, type DayEntriesPage, type DayEntryRow, type MealGroupSummary } from './day-entries-scroll';
import { GROUPS } from './meal-groups';
import { MealDoors } from './meal-doors';
import { MealsNav } from '../../meals-nav';
import { ApiError } from '@/lib/api-error';
import {
  collectMealFoodsIncludingDeleted,
  collectDayEntries,
  getMealTarget,
  listDayEntries,
  restoredFoodName,
  type MealEntry,
  type MealFood,
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

/**
 * One entry as a day-view row: the dish name resolved from the catalog, then the portion and
 * the calorie figure — both already formatted, so the client shell never needs
 * `@life/nutrition` or the catalog (the `CatalogRow` precedent).
 */
function dayEntryRow(entry: MealEntry, catalog: MealFood[]): DayEntryRow {
  // The catalog resolves the stored id to a name; an id matching no row — active or
  // deleted — is a pre-feature entry whose stored value is itself the dish
  // (restoredFoodName). The read includes soft-deleted foods, so a food deleted after
  // logging still names the entry it was logged as. Blank (only a caller bypassing the
  // editor's non-empty rule) falls back to the calories-title row.
  const label = restoredFoodName(entry.foodId, catalog).trim();
  const calories = format('calories', entry.nutrients.calories);
  return {
    id: entry.id,
    mealGroup: entry.mealGroup,
    title: label || calories,
    meta: `× ${entry.quantity}`,
    pill: label ? calories : null,
  };
}

/**
 * Every meal's calorie subtotal over the **whole day**, formatted. `null` is "this meal has no
 * entry anywhere in the day", which is the group's `Not logged` state.
 */
function groupSummaries(entries: MealEntry[]): Record<MealEntry['mealGroup'], MealGroupSummary> {
  const summaries = {} as Record<MealEntry['mealGroup'], MealGroupSummary>;
  for (const group of GROUPS) {
    const items = entries.filter((entry) => entry.mealGroup === group.key);
    summaries[group.key] = {
      calories: items.length === 0 ? null : format('calories', sum(items.map((entry) => entry.nutrients)).calories),
    };
  }
  return summaries;
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
 * Only the ROWS page (`SPEC-load-more`). The headline card and every meal's subtotal
 * are figures over the whole day, so they are computed here from `collectDayEntries`
 * and never from the rows on screen; a page arriving can add rows and cannot move a
 * number (`DayEntriesScroll` owns the appended rows).
 *
 * Nutrient strings come from the shared `@life/nutrition` formatter and totals
 * from its `sum()` (no app-local unit table); the upload atom itself lives on
 * the entry editor — the photo door opens it, it is not composed here.
 *
 * The headline card is the reference's progress card: the day's `Kpi` and one
 * energy track against the target calories — the one figure the card reads out.
 * The card IS the read-out, so it carries the one `role="status"` the day view
 * exposes — a `Kpi` is block content and cannot nest inside a phrasing
 * `StatusText`.
 */
export async function mealDay(day: string, emptyBody: string) {
  // Two reads of the same day on purpose, for two different jobs: `collectDayEntries`
  // walks every cursor because the headline is a figure over the COMPLETE day — the
  // calorie total, the read-out and the energy track must not move as rows append, so
  // they can never be derived from the loaded rows. `listDayEntries` then takes page 1
  // for the row list, which is the only part that pages.
  const [entries, page, target, catalog] = await Promise.all([
    collectDayEntries(day),
    listDayEntries(day),
    loadTarget(day),
    collectMealFoodsIncludingDeleted(),
  ]);
  const totals: NutrientVector = sum(entries.map((entry) => entry.nutrients));
  const readout = dayReadout(totals.calories, target);
  const energyPercent = percentOf(totals.calories, target?.calories ?? 0);

  /**
   * The page after `cursor`, rows built before they cross to the client. A server action, so
   * the owner's token and the catalog stay on the server; the catalog is re-read here rather
   * than captured, because a closure over it would ship the whole catalog to the browser as
   * the action's bound arguments.
   */
  async function loadPage(cursor: string): Promise<DayEntriesPage> {
    'use server';
    const [next, foods] = await Promise.all([
      listDayEntries(day, cursor),
      collectMealFoodsIncludingDeleted(),
    ]);
    return { rows: next.entries.map((entry) => dayEntryRow(entry, foods)), nextCursor: next.nextCursor };
  }

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
                {/* The track is the card's shape, not a target's: with no profile the
                    fill stays empty and the bar still says what was eaten, only against
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
                <ButtonLink href="/meals/target" variant="ghost">
                  {target ? 'Edit target' : 'Set target'}
                </ButtonLink>
              </Stack>
            </Card>
          </Section>
          {/* An empty day is the complete day's own fact (`entries` is every entry of
              the day, not page 1), so the whole-body empty state still stands in for all
              four groups — and a day whose first page is merely empty never shows it. */}
          {entries.length === 0 ? (
            <Section>
              <EmptyState body={emptyBody} />
            </Section>
          ) : (
            <DayEntriesScroll
              rows={page.entries.map((entry) => dayEntryRow(entry, catalog))}
              nextCursor={page.nextCursor}
              groups={groupSummaries(entries)}
              loadPage={loadPage}
            />
          )}
          <MealDoors />
        </>
      }
    />
  );
}
