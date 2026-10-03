import { NUTRIENTS, type NutrientVector } from '@life/nutrition';

/**
 * The one owner of foods content encoding (`SPEC-meal-service` Code Style /
 * at-rest contract): the byte-exact AAD shapes and the nutrient-vector
 * completeness rule. Every seal and every open in `foods.service.ts` goes
 * through a function here, so a field's AAD exists exactly once (lesson 0016)
 * and cannot drift between the write and the read path.
 *
 * AAD is always `life.v1|<sub>|meal|<field>|<id>`, and every `<id>` is
 * service-generated (`randomUUID`) before insert so the string is reconstructible
 * at decrypt time.
 */

/** A stored nutrient vector: an `enc.v1.` envelope, or SQL NULL for all-zero. */
export type StoredVector = string | null;

/** AAD for a food's `name`: `life.v1|<sub>|meal|name|<foodId>`. */
export function foodNameAad(sub: string, foodId: string): string {
  return `life.v1|${sub}|meal|name|${foodId}`;
}

/** AAD for a food's optional base nutrient vector. */
export function foodNutrientsAad(sub: string, foodId: string): string {
  return `life.v1|${sub}|meal|nutrients|${foodId}`;
}

/** AAD for a serving's label: `life.v1|<sub>|meal|label|<servingId>`. */
export function servingLabelAad(sub: string, servingId: string): string {
  return `life.v1|${sub}|meal|label|${servingId}`;
}

/** AAD for a serving's own per-serving nutrient vector. */
export function servingNutrientsAad(sub: string, servingId: string): string {
  return `life.v1|${sub}|meal|serving|${servingId}`;
}

/** The all-zero vector — the stored meaning of "no nutrient data for this field". */
export function zeroVector(): NutrientVector {
  const out = {} as NutrientVector;
  for (const { key } of NUTRIENTS) out[key] = 0;
  return out;
}

/**
 * The single owner of the "a vector is complete" rule: all 27 fields present and
 * finite, and nothing else. A missing or unknown field is rejected rather than
 * defaulted — `SPEC-meal-service` Nutrient semantics allows a *whole* vector of
 * zeroes for absent data, never a partial vector with holes in it, and a
 * silently dropped field would make the day sum quietly wrong.
 */
export function completeVector(value: unknown): NutrientVector {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('nutrient vector must be an object');
  }
  const source = value as Record<string, unknown>;
  if (Object.keys(source).length !== NUTRIENTS.length) {
    throw new Error(`nutrient vector must carry exactly the ${NUTRIENTS.length} nutrient fields`);
  }
  const out = {} as NutrientVector;
  for (const { key } of NUTRIENTS) {
    const number = source[key];
    if (typeof number !== 'number' || !Number.isFinite(number)) {
      throw new Error(`nutrient vector field ${key} must be a finite number`);
    }
    out[key] = number;
  }
  return out;
}

/**
 * Parse a vector out of a decrypted stored payload. Fail-closed: a corrupt row
 * surfaces as an error instead of a plausible-looking day total.
 */
export function readStoredVector(stored: string): NutrientVector {
  return completeVector(JSON.parse(stored) as unknown);
}