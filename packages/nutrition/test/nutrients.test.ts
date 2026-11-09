import { NUTRIENTS, NUTRIENT_LABELS, type Nutrient, type NutrientUnit } from '../src/index.js';

/**
 * Vocabulary invariants for the §0.1-locked nutrient table. A 28th nutrient, a
 * renamed key, or a reordered array is a silent contract break — these tests are
 * the tripwire, not a restatement of the table.
 */

/** Keys in the exact order of `nutrients-loseit.md` §0.1 rows 1–27. */
const ORDERED_KEYS: Nutrient[] = [
  'calories',
  'fat',
  'monounsaturatedFat',
  'polyunsaturatedFat',
  'saturatedFat',
  'transFat',
  'cholesterol',
  'sodium',
  'carbohydrates',
  'fiber',
  'sugar',
  'protein',
  'vitaminA',
  'vitaminC',
  'thiaminB1',
  'riboflavinB2',
  'niacinB3',
  'folateB9',
  'vitaminB6',
  'vitaminB12',
  'calcium',
  'iron',
  'magnesium',
  'phosphorus',
  'potassium',
  'zinc',
  'caffeine',
];

const UNITS: readonly NutrientUnit[] = ['kcal', 'g', 'mg', 'mcg', 'ml'];

describe('NUTRIENTS (§0.1-locked vocabulary)', () => {
  it('has exactly 27 entries with unique keys', () => {
    expect(NUTRIENTS).toHaveLength(27);
    const keys = NUTRIENTS.map((n) => n.key);
    expect(new Set(keys).size).toBe(27);
  });

  it('matches the locked §0.1 key order', () => {
    expect(NUTRIENTS.map((n) => n.key)).toEqual(ORDERED_KEYS);
  });

  it('every unit is in the closed NutrientUnit union', () => {
    for (const n of NUTRIENTS) {
      expect(UNITS).toContain(n.unit);
    }
  });

  it('every key has a non-empty display label', () => {
    for (const n of NUTRIENTS) {
      expect(typeof n.label).toBe('string');
      expect(n.label.length).toBeGreaterThan(0);
    }
  });

  it('NUTRIENT_LABELS covers every nutrient with the table label', () => {
    for (const n of NUTRIENTS) {
      expect(NUTRIENT_LABELS[n.key]).toBe(n.label);
    }
    expect(Object.keys(NUTRIENT_LABELS)).toHaveLength(27);
  });
});
