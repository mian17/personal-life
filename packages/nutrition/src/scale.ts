/**
 * Portion scaling: `food × quantity → NutrientVector`. The service's day-sum
 * and the UI's preview both derive from this one function so they can never
 * disagree on a number.
 */

import { NUTRIENTS, type NutrientVector } from './nutrients.js';
import type { Food } from './food.js';

/**
 * Scale a food's per-serving nutrients by `quantity` (1 = one serving,
 * 0.5 = half). Exactly linear; the result is always a complete vector of
 * all 27 nutrients with no `NaN`/`undefined`/negative values.
 *
 * ponytail: negative or non-finite quantities are clamped to a zero vector —
 * the model scales whatever non-negative number it is given and never invents
 * one (`SPEC-nutrition-model.md` Open Questions); reject upstream if a caller
 * ever needs an error.
 */
export function scale(food: Food, quantity: number): NutrientVector {
  const factor = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
  const out = {} as NutrientVector;
  for (const { key } of NUTRIENTS) {
    const value = food.nutrients[key];
    out[key] = factor === 0 ? 0 : Math.max(0, value * factor);
  }
  return out;
}
