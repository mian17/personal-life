/**
 * Day summation: `NutrientVector[] → NutrientVector`. The service sums a day's
 * entries; the UI may sum a meal the same way. One function so the two can never
 * disagree on a total.
 */

import { NUTRIENTS, type NutrientVector } from './nutrients';

/**
 * Add vectors together, nutrient by nutrient. Exactly additive: each output
 * field is the plain sum of that field across the inputs, in any order. An empty
 * input is a complete all-zero vector (all 27 keys), never a partial object.
 */
export function sum(vectors: readonly NutrientVector[]): NutrientVector {
  const out = {} as NutrientVector;
  for (const { key } of NUTRIENTS) {
    let total = 0;
    for (const vector of vectors) total += vector[key];
    out[key] = total;
  }
  return out;
}
