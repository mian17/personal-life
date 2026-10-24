/**
 * Display formatting: absolute-mass `NutrientVector`s become UI strings here,
 * and only here. `%DV` is a display derivation — computed on read from
 * `DAILY_VALUES`, never stored in and never returned by `scale`/`sum`.
 */

import { NUTRIENTS, type Nutrient, type NutrientUnit } from './nutrients';

/**
 * The `%DV`-eligible micronutrients, keyed like `NUTRIENTS` so a non-eligible
 * nutrient is an explicit `null` rather than an absent key. Values are the FDA
 * Daily Values, in each nutrient's own stored unit (`SPEC-nutrition-model.md`).
 * Calories, macros, fat breakdown, cholesterol, sodium, fiber, sugar, caffeine,
 * and trans fat are not `%DV`-eligible.
 */
export const DAILY_VALUES: Record<Nutrient, number | null> = {
  calories: null,
  fat: null,
  monounsaturatedFat: null,
  polyunsaturatedFat: null,
  saturatedFat: null,
  transFat: null,
  cholesterol: null,
  sodium: null,
  carbohydrates: null,
  fiber: null,
  sugar: null,
  protein: null,
  vitaminA: 900,
  vitaminC: 90,
  thiaminB1: 1.2,
  riboflavinB2: 1.3,
  niacinB3: 16,
  folateB9: 400,
  vitaminB6: 1.7,
  vitaminB12: 2.4,
  calcium: 1300,
  iron: 18,
  magnesium: 420,
  phosphorus: 1250,
  potassium: 4700,
  zinc: 11,
  caffeine: null,
};

/** The unknown affordance: an estimated-but-unknown value renders this, never `0`. */
export const UNKNOWN = '—';

const UNITS = Object.fromEntries(
  NUTRIENTS.map((n) => [n.key, n.unit]),
) as Record<Nutrient, NutrientUnit>;

/**
 * Render a value with its unit, or `UNKNOWN` when the model does not know it
 * (`null`/`undefined`/`NaN`/negative — a nutrient mass is never negative).
 * A real `0` stays a real `0`.
 *
 * Precision is per unit and magnitude, so nothing renders as an awkward
 * `0.0024 mg`: a sub-1 `g`/`mg` value is promoted one unit (`0.0024 mg` →
 * `2.4 mcg`) and trailing zeros are dropped (`2.40` → `2.4`). Unit strings are
 * ASCII — `mcg`, never `µg`.
 */
export function format(nutrient: Nutrient, value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return UNKNOWN;
  const unit = UNITS[nutrient];
  const [amount, displayUnit] = promote(value, unit);
  return `${render(amount, displayUnit)} ${displayUnit}`;
}

/**
 * The `%DV` of an absolute-mass value, or `null` when the nutrient is not
 * `%DV`-eligible. `UNKNOWN` propagates — an unknown value has no `%DV`, and a
 * `%DV` of an unknown is never a fabricated `0`.
 */
export function formatDailyValue(
  nutrient: Nutrient,
  value: number | null | undefined,
): string | null {
  const reference = DAILY_VALUES[nutrient];
  if (reference == null) return null;
  if (value == null || !Number.isFinite(value) || value < 0) return UNKNOWN;
  return `${Math.round((value / reference) * 100)}%`;
}

/** A value below 1 in `g`/`mg` reads better one unit up; everything else stays put. */
function promote(value: number, unit: NutrientUnit): [number, NutrientUnit] {
  if (value > 0 && value < 1) {
    if (unit === 'g') return [value * 1000, 'mg'];
    if (unit === 'mg') return [value * 1000, 'mcg'];
  }
  return [value, unit];
}

/** kcal whole; small values keep a decimal, big ones do not. */
function decimalsFor(amount: number, unit: NutrientUnit): number {
  if (unit === 'kcal' || amount >= 100) return 0;
  return amount >= 10 ? 1 : 2;
}

/** Trailing zeros, then a bare trailing point — a linear scan, no backtracking. */
function trimZeros(text: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === '0') end -= 1;
  const trimmed = text.slice(0, end);
  return trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
}

function render(amount: number, unit: NutrientUnit): string {
  const decimals = decimalsFor(amount, unit);
  const text = amount.toFixed(decimals);
  return decimals === 0 ? text : trimZeros(text);
}