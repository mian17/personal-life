/**
 * The food/portion model: a `Food` declares what one serving weighs and the
 * nutrients that serving provides; a `Portion` names a serving size the user
 * can pick; an entry stores the confirmed `Serving` plus a multiplier so the
 * nutrient math stays `scale(serving, quantity)` — pure and clock-free.
 */

import type { NutrientVector } from './nutrients.js';

/** A named, measured serving size ("100 g", "1 cup") the user can pick. */
export interface Serving {
  /** Human-readable size, exactly as stored ("100 g", "1 cup"). */
  readonly label: string;
  /** How many base units of the food this serving represents. */
  readonly grams: number;
}

/** One food record: per-serving nutrients plus the pickable serving sizes. */
export interface Food {
  readonly id: string;
  readonly name: string;
  /** One serving's weight in grams — the unit `Serving.grams` scales against. */
  readonly servingGrams: number;
  /** Nutrients for exactly ONE serving (quantity 1). Never `%DV`. */
  readonly nutrients: NutrientVector;
  /** Serving sizes offered for this food; the base serving is implicit. */
  readonly portions: readonly Serving[];
}

/** What an entry actually records: the serving the user confirmed + a multiplier. */
export interface Portion {
  readonly serving: Serving;
  /** Servings eaten — the `quantity` fed to `scale`. */
  readonly quantity: number;
}
