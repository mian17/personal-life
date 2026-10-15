import { NUTRIENTS, sum, type Nutrient, type NutrientVector } from '../src/index';

/**
 * Day-summation invariants: exact additivity, completeness of the result at
 * any input size (including none), and totality — a day total is never partial.
 */

const KEYS: Nutrient[] = NUTRIENTS.map((n) => n.key);

/** A complete vector with distinct values so a swapped or dropped field shows. */
function vector(multiplier: number): NutrientVector {
  const v = {} as NutrientVector;
  KEYS.forEach((key, i) => {
    v[key] = (i + 1) * multiplier;
  });
  return v;
}

describe('sum', () => {
  it('empty input yields a complete all-zero vector (all 27 keys present)', () => {
    const zero = sum([]);
    expect(Object.keys(zero).sort()).toEqual([...KEYS].sort());
    expect(Object.keys(zero)).toHaveLength(27);
    for (const key of KEYS) expect(zero[key]).toBe(0);
  });

  it('is exactly additive: each field is the plain sum of that field', () => {
    const total = sum([vector(1), vector(2), vector(0.5)]);
    for (const key of KEYS) expect(total[key]).toBe((1 + 2 + 0.5) * (KEYS.indexOf(key) + 1));
  });

  it('summing one vector returns it unchanged', () => {
    expect(sum([vector(3)])).toEqual(vector(3));
  });

  it('order does not matter: summation commutes across inputs', () => {
    expect(sum([vector(1), vector(2), vector(0.5)])).toEqual(sum([vector(0.5), vector(2), vector(1)]));
  });

  it('every result is a complete vector of numbers, never NaN or negative', () => {
    for (const inputs of [[], [vector(1)], [vector(0.25), vector(7)]]) {
      const total = sum(inputs);
      expect(Object.keys(total)).toHaveLength(27);
      for (const key of KEYS) {
        expect(typeof total[key]).toBe('number');
        expect(Number.isNaN(total[key])).toBe(false);
        expect(total[key]).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
