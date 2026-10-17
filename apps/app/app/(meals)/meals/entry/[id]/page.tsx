import 'server-only';
import { loadOrNotFound } from '@life/app-kit';
import {
  format,
  NUTRIENT_LABELS,
  NUTRIENTS,
  UNKNOWN,
  type Nutrient,
  type NutrientVector,
} from '@life/nutrition';
import {
  getMealEntry,
  listMealFoods,
  listMealFoodsIncludingDeleted,
  restoredFoodName,
  type MealFood,
} from '@/lib/meal-api';
import { getToday } from '@/lib/today';
import { MealEditor, type NutritionFields } from './editor';
import type { PickerFood } from './food-picker';

export const dynamic = 'force-dynamic';

/** The fields the review step shows inline, in display order (one display choice, not a unit table). */
const HEADLINE = ['calories', 'fat', 'carbohydrates', 'protein'] as const satisfies readonly Nutrient[];

/**
 * The seven display groups for the expanded `All nutrients (27)` region. Grouping is
 * an app-owned display choice — `@life/nutrition`'s set is flat — but the keys,
 * labels, and units all come from the package. `Other` holds exactly `Caffeine`, the
 * one nutrient with no home group. Every key appears once across the groups.
 */
const GROUPS: { title: string; keys: readonly Nutrient[] }[] = [
  { title: 'Macros', keys: ['calories', 'fat', 'carbohydrates', 'protein'] },
  { title: 'Fat breakdown', keys: ['monounsaturatedFat', 'polyunsaturatedFat', 'saturatedFat', 'transFat'] },
  { title: 'Cholesterol & sodium', keys: ['cholesterol', 'sodium'] },
  { title: 'Carb breakdown', keys: ['fiber', 'sugar'] },
  { title: 'Vitamins', keys: ['vitaminA', 'vitaminC', 'thiaminB1', 'riboflavinB2', 'niacinB3', 'folateB9', 'vitaminB6', 'vitaminB12'] },
  { title: 'Minerals', keys: ['calcium', 'iron', 'magnesium', 'phosphorus', 'potassium', 'zinc'] },
  { title: 'Other', keys: ['caffeine'] },
];

/** The unit `@life/nutrition` declares for a key — the one owner of units. */
function unitOf(key: Nutrient): string {
  return NUTRIENTS.find((nutrient) => nutrient.key === key)!.unit;
}

/** A field as the client renders it: the key, its package label, and its package unit. */
function field(key: Nutrient) {
  return { key, label: NUTRIENT_LABELS[key], unit: unitOf(key) };
}

/**
 * Everything the client editor needs from `@life/nutrition`, derived here as
 * plain JSON: the package is server-side only (plan Task 14 — no `'use client'`
 * component may import it), so the inline field list, the expanded groups, the
 * unknown affordance, the all-zero vector, and the total's unit cross the
 * server/client boundary as props.
 */
const NUTRITION: NutritionFields = {
  fields: HEADLINE.map(field),
  extraCount: NUTRIENTS.length - HEADLINE.length,
  groups: GROUPS.map(({ title, keys }) => ({ title, fields: keys.map(field) })),
  unknown: UNKNOWN,
  empty: Object.fromEntries(NUTRIENTS.map(({ key }) => [key, 0])) as NutrientVector,
  totalUnit: unitOf('calories'),
};

/**
 * The catalog the `door=food` picker offers, with the per-100 facts formatted
 * here so the client needs no `@life/nutrition` (same row rule as the catalog
 * page's own list).
 */
function pickerFoods(foods: MealFood[]): PickerFood[] {
  return foods.map((food) => ({
    food,
    per100Calories: `per 100 ${food.unit} · ${format('calories', food.nutrients.calories)}`,
  }));
}

/**
 * The review-correct editor for one entry (`SPEC-meal-capture-ui` project
 * structure). `new` is the photo/manual create door the day view links to, so
 * it opens an empty, pre-opened editor; any other id is the entry being
 * corrected. The day the entry belongs to comes from the shared `getToday()`
 * owner (lesson 0019) for a new entry, and from the entry itself when editing —
 * this route never derives a day of its own.
 */
export default async function MealEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ door?: string }>;
}) {
  const { id } = await params;

  if (id === 'new') {
    // The door query picks how `new` opens: the photo editor or the catalog
    // picker. Any value the day view does not send opens the empty editor —
    // never a broken door.
    const mealDoor = (await searchParams).door === 'food' ? ('food' as const) : null;
    const date = await getToday();
    const foods = mealDoor === 'food' ? pickerFoods(await listMealFoods()) : [];
    return (
      <MealEditor
        entry={null}
        date={date}
        nutrition={NUTRITION}
        door={mealDoor}
        foods={foods}
      />
    );
  }

  const entry = await loadOrNotFound(() => getMealEntry(id));
  // Name resolution reads the whole catalog (soft-deleted rows included): the
  // entry's dish name must survive the food being deleted (AC5).
  const catalog = await listMealFoodsIncludingDeleted();
  return (
    <MealEditor
      entry={entry}
      date={entry.date}
      nutrition={NUTRITION}
      foodName={restoredFoodName(entry.foodId, catalog)}
    />
  );
}
