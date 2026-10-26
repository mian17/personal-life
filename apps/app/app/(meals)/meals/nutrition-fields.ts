import { NUTRIENT_LABELS, NUTRIENTS, type Nutrient } from '@life/nutrition';

/**
 * The seven display groups of the nutrition facts, in display order. Grouping is an
 * app-owned display choice — `@life/nutrition`'s set is flat — but every key, label
 * and unit comes from the package. `Other` holds exactly `Caffeine`, the one nutrient
 * with no home group; every one of the 27 keys appears exactly once.
 *
 * Both catalog and entry surfaces read these groups, so a food's facts and a logged
 * item's facts read alike. This module is server-side only: no `'use client'`
 * component may import it (plan Task 14), so callers pass the derived data down.
 */
export const GROUPS: { title: string; keys: readonly Nutrient[] }[] = [
  { title: 'Macros', keys: ['calories', 'fat', 'carbohydrates', 'protein'] },
  {
    title: 'Fat breakdown',
    keys: ['monounsaturatedFat', 'polyunsaturatedFat', 'saturatedFat', 'transFat'],
  },
  { title: 'Cholesterol & sodium', keys: ['cholesterol', 'sodium'] },
  { title: 'Carb breakdown', keys: ['fiber', 'sugar'] },
  {
    title: 'Vitamins',
    keys: [
      'vitaminA',
      'vitaminC',
      'thiaminB1',
      'riboflavinB2',
      'niacinB3',
      'folateB9',
      'vitaminB6',
      'vitaminB12',
    ],
  },
  {
    title: 'Minerals',
    keys: ['calcium', 'iron', 'magnesium', 'phosphorus', 'potassium', 'zinc'],
  },
  { title: 'Other', keys: ['caffeine'] },
];

/** The unit `@life/nutrition` declares for a key — the one owner of units. */
export function unitOf(key: Nutrient): string {
  return NUTRIENTS.find((nutrient) => nutrient.key === key)!.unit;
}

/** One nutrient as a server page sends it to a client: key, package label, package unit. */
export interface NutrientField {
  key: Nutrient;
  label: string;
  unit: string;
}

/** A field as the client renders it: the key, its package label, and its package unit. */
export function field(key: Nutrient): NutrientField {
  return { key, label: NUTRIENT_LABELS[key], unit: unitOf(key) };
}

/** The seven groups with their fields resolved for the client. */
export function groupedFields(): { title: string; fields: NutrientField[] }[] {
  return GROUPS.map(({ title, keys }) => ({ title, fields: keys.map(field) }));
}
