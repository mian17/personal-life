import 'server-only';
import { loadOrNotFound } from '@life/app-kit';
import {
  NUTRIENT_LABELS,
  NUTRIENTS,
  UNKNOWN,
  type Nutrient,
  type NutrientVector,
} from '@life/nutrition';
import { getMealEntry, listMealFoods, restoredFoodName } from '@/lib/meal-api';
import { getToday } from '@/lib/today';
import { MealEditor, type NutritionFields } from './editor';

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
 * The review-correct editor for one entry (`SPEC-meal-capture-ui` project
 * structure). `new` is the photo/manual create door the day view links to, so
 * it opens an empty, pre-opened editor; any other id is the entry being
 * corrected. The day the entry belongs to comes from the shared `getToday()`
 * owner (lesson 0019) for a new entry, and from the entry itself when editing —
 * this route never derives a day of its own.
 */
export default async function MealEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (id === 'new') {
    const date = await getToday();
    return <MealEditor entry={null} date={date} nutrition={NUTRITION} />;
  }

  const entry = await loadOrNotFound(() => getMealEntry(id));
  const catalog = await listMealFoods();
  return (
    <MealEditor
      entry={entry}
      date={entry.date}
      nutrition={NUTRITION}
      foodName={restoredFoodName(entry.foodId, catalog)}
    />
  );
}
