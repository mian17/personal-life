import {
  DAILY_VALUES,
  NUTRIENTS,
  UNKNOWN,
  format,
  formatDailyValue,
  scale,
  sum,
  type Food,
  type NutrientVector,
} from '../src/index.js';

/**
 * Display invariants: `%DV` is a read-time derivation that must never leak into
 * the stored shape (`scale`/`sum`), `mcg` stays ASCII and human-readable, and an
 * unknown value renders the em dash — never a fabricated `0`.
 */

const FOOD: Food = {
  id: 'f1',
  name: 'Test Food',
  servingGrams: 100,
  nutrients: (() => {
    const v = {} as NutrientVector;
    NUTRIENTS.forEach((n, i) => (v[n.key] = (i + 1) * 100));
    return v;
  })(),
  portions: [{ label: '100 g', grams: 100 }],
};

describe('format (unit rendering)', () => {
  it('renders mcg as ASCII mcg, never µg, and keeps tiny values readable', () => {
    expect(format('vitaminB12', 2.4)).toBe('2.4 mcg');
    expect(format('vitaminB12', 240)).toBe('240 mcg');
    expect(format('folateB9', 400)).toBe('400 mcg');
    expect(format('vitaminA', 900)).toBe('900 mcg');
    for (const n of NUTRIENTS) {
      const text = format(n.key, 12.34);
      expect(text).not.toContain('µ');
      expect(text).not.toMatch(/0\.00\d/);
    }
  });

  it('does not render awkward 0.0024 mg-style strings — small values promote a unit', () => {
    expect(format('sodium', 0.0024)).toBe('2.4 mcg');
    expect(format('saturatedFat', 0.04)).toBe('40 mg');
    expect(format('saturatedFat', 0.4)).toBe('400 mg');
    expect(format('saturatedFat', 0)).toBe('0 g');
  });

  it('kcal renders as a whole number; mg/g keep sensible precision', () => {
    expect(format('calories', 1850.6)).toBe('1851 kcal');
    expect(format('calories', 0)).toBe('0 kcal');
    expect(format('protein', 25.5)).toBe('25.5 g');
    expect(format('protein', 100)).toBe('100 g');
    expect(format('vitaminC', 90)).toBe('90 mg');
    expect(format('sodium', 2300)).toBe('2300 mg');
  });

  it('an unknown value renders the em dash — never a fabricated 0', () => {
    for (const n of NUTRIENTS) {
      expect(format(n.key, null)).toBe(UNKNOWN);
      expect(format(n.key, undefined)).toBe(UNKNOWN);
      expect(format(n.key, Number.NaN)).toBe(UNKNOWN);
      expect(format(n.key, -5)).toBe(UNKNOWN);
      expect(UNKNOWN).toBe('—');
    }
  });
});

describe('formatDailyValue (%DV derivation)', () => {
  it('derives %DV from the reference table, in the nutrient’s own unit', () => {
    expect(DAILY_VALUES.vitaminA).toBe(900);
    expect(DAILY_VALUES.vitaminC).toBe(90);
    expect(DAILY_VALUES.calcium).toBe(1300);
    expect(DAILY_VALUES.iron).toBe(18);
    expect(DAILY_VALUES.zinc).toBe(11);
    expect(formatDailyValue('vitaminC', 45)).toBe('50%');
    expect(formatDailyValue('vitaminC', 90)).toBe('100%');
    expect(formatDailyValue('iron', 9)).toBe('50%');
    expect(formatDailyValue('vitaminB12', 1.2)).toBe('50%');
  });

  it('returns null for nutrients that are not %DV-eligible', () => {
    expect(formatDailyValue('calories', 100)).toBeNull();
    expect(formatDailyValue('sodium', 2300)).toBeNull();
    expect(formatDailyValue('carbohydrates', 300)).toBeNull();
    expect(formatDailyValue('fiber', 28)).toBeNull();
    expect(formatDailyValue('sugar', 50)).toBeNull();
    expect(formatDailyValue('transFat', 2)).toBeNull();
    expect(formatDailyValue('cholesterol', 300)).toBeNull();
    expect(formatDailyValue('caffeine', 100)).toBeNull();
  });

  it('an unknown value yields the em dash, never a fabricated 0%', () => {
    expect(formatDailyValue('vitaminC', null)).toBe(UNKNOWN);
    expect(formatDailyValue('vitaminC', Number.NaN)).toBe(UNKNOWN);
    expect(formatDailyValue('vitaminC', undefined)).toBe(UNKNOWN);
  });
});

describe('%DV never leaks into the stored shape', () => {
  it('scale and sum output contain only absolute masses — no %DV anywhere', () => {
    const scaled = scale(FOOD, 2);
    const total = sum([scale(FOOD, 1), scaled]);
    for (const out of [scaled, total]) {
      const serialized = JSON.stringify(out);
      expect(serialized).not.toContain('%');
      expect(serialized).not.toContain('DV');
      for (const n of NUTRIENTS) {
        expect(typeof out[n.key]).toBe('number');
      }
      expect(Object.keys(out).sort()).toEqual(NUTRIENTS.map((n) => n.key).sort());
    }
  });

  it('%DV is derived only in format, from a zero-arg-free read of the table', () => {
    expect(Object.keys(DAILY_VALUES).sort()).toEqual(NUTRIENTS.map((n) => n.key).sort());
  });
});
