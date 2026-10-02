/**
 * `@life/nutrition` — the nutrient vocabulary every consumer shares.
 *
 * The 27 fields and their units come from `docs/research/nutrients-loseit.md` §0.1,
 * which locked them with the user. This module exists so the service that sums a day
 * and the UI that renders it cannot disagree: the table is declared once, here, and
 * both sides derive from it.
 */

/** Closed unit vocabulary. `mcg` is ASCII, never `µg`. */
export type NutrientUnit = 'kcal' | 'g' | 'mg' | 'mcg' | 'ml';

/** The 27 nutrient keys, camelCase, in §0.1 order (mirrors `NUTRIENTS`). */
export type Nutrient =
  | 'calories'
  | 'fat'
  | 'monounsaturatedFat'
  | 'polyunsaturatedFat'
  | 'saturatedFat'
  | 'transFat'
  | 'cholesterol'
  | 'sodium'
  | 'carbohydrates'
  | 'fiber'
  | 'sugar'
  | 'protein'
  | 'vitaminA'
  | 'vitaminC'
  | 'thiaminB1'
  | 'riboflavinB2'
  | 'niacinB3'
  | 'folateB9'
  | 'vitaminB6'
  | 'vitaminB12'
  | 'calcium'
  | 'iron'
  | 'magnesium'
  | 'phosphorus'
  | 'potassium'
  | 'zinc'
  | 'caffeine';

export interface NutrientInfo {
  key: Nutrient;
  /** Display label, exactly as the Lose It! screens spell it. */
  label: string;
  unit: NutrientUnit;
}

/**
 * The 27 nutrients in the exact order agreed in `nutrients-loseit.md` §0.1. Order is
 * part of the contract: the UI renders rows from this array, so it is never sorted.
 * (Water is §0.1 row 28 but day-level only, so it is not part of the food vocabulary.)
 */
export const NUTRIENTS: readonly NutrientInfo[] = [
  { key: 'calories', label: 'Calories', unit: 'kcal' },
  { key: 'fat', label: 'Fat', unit: 'g' },
  { key: 'monounsaturatedFat', label: 'Monounsaturated Fat', unit: 'g' },
  { key: 'polyunsaturatedFat', label: 'Polyunsaturated Fat', unit: 'g' },
  { key: 'saturatedFat', label: 'Saturated Fat', unit: 'g' },
  { key: 'transFat', label: 'Trans Fat', unit: 'g' },
  { key: 'cholesterol', label: 'Cholesterol', unit: 'mg' },
  { key: 'sodium', label: 'Sodium', unit: 'mg' },
  { key: 'carbohydrates', label: 'Carbohydrates', unit: 'g' },
  { key: 'fiber', label: 'Fiber', unit: 'g' },
  { key: 'sugar', label: 'Sugar', unit: 'g' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'vitaminA', label: 'Vitamin A', unit: 'mcg' },
  { key: 'vitaminC', label: 'Vitamin C', unit: 'mg' },
  { key: 'thiaminB1', label: 'Thiamin (B1)', unit: 'mg' },
  { key: 'riboflavinB2', label: 'Riboflavin (B2)', unit: 'mg' },
  { key: 'niacinB3', label: 'Niacin (B3)', unit: 'mg' },
  { key: 'folateB9', label: 'Folate (B9)', unit: 'mcg' },
  { key: 'vitaminB6', label: 'Vitamin B6', unit: 'mg' },
  { key: 'vitaminB12', label: 'Vitamin B12', unit: 'mcg' },
  { key: 'calcium', label: 'Calcium', unit: 'mg' },
  { key: 'iron', label: 'Iron', unit: 'mg' },
  { key: 'magnesium', label: 'Magnesium', unit: 'mg' },
  { key: 'phosphorus', label: 'Phosphorus', unit: 'mg' },
  { key: 'potassium', label: 'Potassium', unit: 'mg' },
  { key: 'zinc', label: 'Zinc', unit: 'mg' },
  { key: 'caffeine', label: 'Caffeine', unit: 'mg' },
];

/** Key → display label, for consumers that render a single nutrient by key. */
export const NUTRIENT_LABELS: Record<Nutrient, string> = Object.fromEntries(
  NUTRIENTS.map((n) => [n.key, n.label]),
) as Record<Nutrient, string>;

/** A nutrient vector is total, never partial: every nutrient is present. */
export type NutrientVector = Record<Nutrient, number>;