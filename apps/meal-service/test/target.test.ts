import {
  ACTIVITY_FACTORS,
  ACTIVITY_LEVELS,
  basalMetabolicRate,
  totalDailyEnergyExpenditure,
  type Profile,
} from '../src/targets/target-calculator';
import { GOALS, KCAL_PER_G, calculateTarget } from '../src/targets/target';

/**
 * Worked examples. Mifflin-St Jeor:
 *   male:   10w + 6.25h − 5a + 5
 *   female: 10w + 6.25h − 5a − 161
 */
const MALE: Profile = {
  age: 30,
  sex: 'male',
  heightCm: 180,
  weightKg: 80,
  activity: 'moderate',
};
const FEMALE: Profile = {
  age: 30,
  sex: 'female',
  heightCm: 165,
  weightKg: 60,
  activity: 'moderate',
};

describe('basalMetabolicRate', () => {
  it('applies the male intercept (+5) exactly', () => {
    // 800 + 1125 − 150 + 5
    expect(basalMetabolicRate(MALE)).toBe(1780);
  });

  it('applies the female intercept (−161) exactly', () => {
    // 600 + 1031.25 − 150 − 161 = 1320.25
    expect(basalMetabolicRate(FEMALE)).toBe(1320);
  });
});

describe('ACTIVITY_FACTORS', () => {
  it('names every activity level in the enum', () => {
    expect(Object.keys(ACTIVITY_FACTORS).sort()).toEqual(
      [...ACTIVITY_LEVELS].sort(),
    );
  });

  it('uses the standard Harris-Benedict multipliers', () => {
    expect(ACTIVITY_FACTORS).toEqual({
      sedentary: 1.2,
      light: 1.375,
      moderate: 1.55,
      active: 1.725,
      veryActive: 1.9,
    });
  });
});

describe('totalDailyEnergyExpenditure', () => {
  it('multiplies BMR by the named activity factor', () => {
    // 1780 × 1.55
    expect(totalDailyEnergyExpenditure(MALE)).toBe(2759);
  });

  it('is BMR-scaling for every activity level (exhaustive)', () => {
    const bmr = basalMetabolicRate(MALE);
    for (const level of ACTIVITY_LEVELS) {
      expect(totalDailyEnergyExpenditure({ ...MALE, activity: level })).toBe(
        Math.round(bmr * ACTIVITY_FACTORS[level]),
      );
    }
  });
});

describe('calculateTarget', () => {
  it('derives from the profile, never from a fixed number', () => {
    expect(GOALS).toEqual(['lose', 'maintain', 'gain']);
    const t = calculateTarget(FEMALE, 'maintain');
    expect(t.bmr).toBe(basalMetabolicRate(FEMALE));
    expect(t.tdee).toBe(totalDailyEnergyExpenditure(FEMALE));
    expect(t.calories).toBe(t.tdee);
    expect(calculateTarget({ ...FEMALE, weightKg: 70 }, 'maintain').calories).not.toBe(
      t.calories,
    );
  });

  it('rounds macro grams into the calorie target within rounding', () => {
    const profile: Profile = { ...MALE, weightKg: 80.4 };
    for (const goal of GOALS) {
      const t = calculateTarget(profile, goal);
      const fromGrams =
        t.proteinG * KCAL_PER_G.protein +
        t.fatG * KCAL_PER_G.fat +
        t.carbG * KCAL_PER_G.carb;
      // Protein/fat are ceil'd to whole grams and carbs rounded to the nearest,
      // so the residual is bounded by one gram of each floor plus half a gram
      // of carbs.
      const bound =
        KCAL_PER_G.protein + KCAL_PER_G.fat + KCAL_PER_G.carb / 2;
      expect(Math.abs(fromGrams - t.calories)).toBeLessThanOrEqual(bound);
    }
  });

  it('keeps protein and fat at their gram/kg floors', () => {
    const t = calculateTarget(FEMALE, 'maintain');
    expect(t.proteinG).toBeGreaterThanOrEqual(Math.ceil(FEMALE.weightKg * 1.6));
    expect(t.fatG).toBeGreaterThanOrEqual(Math.ceil(FEMALE.weightKg * 0.6));
  });

  it('applies the goal delta to TDEE', () => {
    const maintain = calculateTarget(MALE, 'maintain');
    const lose = calculateTarget(MALE, 'lose');
    const gain = calculateTarget(MALE, 'gain');
    expect(maintain.calories).toBe(maintain.tdee);
    expect(lose.calories).toBeLessThan(maintain.calories);
    expect(gain.calories).toBeGreaterThan(maintain.calories);
  });
});
