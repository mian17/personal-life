import { NUTRIENTS, scale, type Food, type Nutrient, type NutrientVector } from '../src/index';

/**
 * Scaling invariants: exact linearity at 0×/0.5×/2×, totality (all 27 keys even
 * at quantity 0), and no `NaN`/`undefined`/negative — the correctness core the
 * service's day-sum and the UI's preview both depend on.
 */

const KEYS: Nutrient[] = NUTRIENTS.map((n) => n.key);

/** A complete vector with distinct, non-zero values so any mix-up is visible. */
function fullVector(multiplier: number): NutrientVector {
  const v = {} as NutrientVector;
  KEYS.forEach((key, i) => {
    v[key] = (i + 1) * multiplier;
  });
  return v;
}

const FOOD: Food = {
  id: 'f1',
  name: 'Test Food',
  servingGrams: 100,
  nutrients: fullVector(1),
  portions: [{ label: '100 g', grams: 100 }],
};

describe('scale', () => {
  it('quantity 1 returns the per-serving vector unchanged', () => {
    expect(scale(FOOD, 1)).toEqual(FOOD.nutrients);
  });

  it('is exactly linear at 0×, 0.5×, and 2×', () => {
    expect(scale(FOOD, 0)).toEqual(fullVector(0));
    expect(scale(FOOD, 0.5)).toEqual(fullVector(0.5));
    expect(scale(FOOD, 2)).toEqual(fullVector(2));
  });

  it('quantity 0 yields a complete all-zero vector (all 27 keys present)', () => {
    const zero = scale(FOOD, 0);
    expect(Object.keys(zero).sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) expect(zero[key]).toBe(0);
  });

  it('every result is a complete vector with no NaN/undefined/negative', () => {
    for (const q of [0, 0.5, 1, 2, 7.25]) {
      const v = scale(FOOD, q);
      expect(Object.keys(v)).toHaveLength(27);
      for (const key of KEYS) {
        expect(typeof v[key]).toBe('number');
        expect(Number.isNaN(v[key])).toBe(false);
        expect(v[key]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('clamps invalid (negative/non-finite) quantities to an all-zero complete vector', () => {
    for (const q of [-1, Number.NaN, Infinity, -Infinity]) {
      const v = scale(FOOD, q);
      expect(Object.keys(v)).toHaveLength(27);
      for (const key of KEYS) expect(v[key]).toBe(0);
    }
  });
});
