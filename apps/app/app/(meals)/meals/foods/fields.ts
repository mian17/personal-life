import {
  NUTRIENT_LABELS,
  NUTRIENTS,
  type Nutrient,
} from '@life/nutrition';
import type { FoodNutrition, NutrientField } from './food-form';

/**
 * The seven display groups of the food form's fact fields. Grouping is an
 * app-owned display choice — `@life/nutrition`'s set is flat — but every key,
 * label and unit comes from the package. It is the same grouping the entry
 * editor shows, so a food's facts and a logged item's facts read alike. `Other`
 * holds exactly `Caffeine`, the one nutrient with no home group; every one of
 * the 27 keys appears exactly once.
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
function field(key: Nutrient): NutrientField {
  return { key, label: NUTRIENT_LABELS[key], unit: unitOf(key) };
}

/**
 * The facts the form renders, derived here as plain JSON: `@life/nutrition` is
 * server-side only (plan Task 14 — no `'use client'` component imports it), so
 * the labels and units cross the boundary as data. Both catalog pages share
 * this one derivation instead of each spelling the groups.
 */
export const FOOD_NUTRITION: FoodNutrition = {
  groups: GROUPS.map(({ title, keys }) => ({ title, fields: keys.map(field) })),
};
