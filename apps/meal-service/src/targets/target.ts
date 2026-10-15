/**
 * Profile + goal → the day's target (`SPEC-target-onboarding.md`). Pure: no
 * clock, no DB, no network, no NestJS. Callers persist both the profile inputs
 * and these outputs, so a past date re-renders against the row that applied
 * then instead of a mutable "latest" target.
 */
import {
  type Profile,
  basalMetabolicRate,
  totalDailyEnergyExpenditure,
} from './target-calculator';

/** The weight goal. Declared as a value array for exhaustive keying. */
export const GOALS = ['lose', 'maintain', 'gain'] as const;
export type Goal = (typeof GOALS)[number];

/**
 * Fraction of TDEE applied to reach the goal. Deliberately modest: a 0.15
 * deficit is the classic ~0.5 kg/week, and a deficit is only safe because the
 * gram floors below do not shrink with the calorie target.
 */
export const GOAL_CALORIE_ADJUSTMENT: Record<Goal, number> = {
  lose: -0.15,
  maintain: 0,
  gain: 0.1,
};

/**
 * Atwater factors. The one place grams ⇄ kcal is stated; the test reconciles
 * against these rather than repeating the numbers.
 */
export const KCAL_PER_G = { protein: 4, fat: 9, carb: 4 } as const;

/**
 * Macro floors in grams per kg of bodyweight — floors, not percentages: a
 * percentage split on a low calorie target silently starves protein, which is
 * the failure the spec forbids ("never a floating percentage-only macro split
 * with no gram floors"). 1.6 g/kg is the commonly cited ceiling for muscle
 * protein synthesis; 0.6 g/kg (~20% of calories) covers essential fat and
 * hormones while staying low enough not to crowd out carbs in a deficit.
 */
export const PROTEIN_G_PER_KG = 1.6;
export const FAT_G_PER_KG = 0.6;

export interface Target {
  bmr: number;
  tdee: number;
  calories: number;
  proteinG: number;
  fatG: number;
  carbG: number;
}

/**
 * Derive the day's calorie target and macro split. Protein and fat sit at
 * their gram floors; carbohydrate is the flexible remainder of the calorie
 * target.
 *
 * ponytail: a target below the two floors (never reachable from a plausible
 * profile and the DTO's ranges) clamps carbs at 0 and lets the gram total
 * overshoot kcal. Fix upstream in the macro-split policy if that ever changes.
 */
export function calculateTarget(profile: Profile, goal: Goal): Target {
  const bmr = basalMetabolicRate(profile);
  const tdee = totalDailyEnergyExpenditure(profile);
  const calories = Math.round(tdee * (1 + GOAL_CALORIE_ADJUSTMENT[goal]));

  // Floors are ceil'd: an integer gram value must never sit below the policy.
  const proteinG = Math.ceil(profile.weightKg * PROTEIN_G_PER_KG);
  const fatG = Math.ceil(profile.weightKg * FAT_G_PER_KG);
  const carbG = Math.max(
    0,
    Math.round(
      (calories - proteinG * KCAL_PER_G.protein - fatG * KCAL_PER_G.fat) /
        KCAL_PER_G.carb,
    ),
  );

  return { bmr, tdee, calories, proteinG, fatG, carbG };
}
