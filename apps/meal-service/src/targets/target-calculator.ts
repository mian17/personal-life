/**
 * The formula layer of the target derivation (`SPEC-target-onboarding.md`):
 * Mifflin-St Jeor BMR and the activity multipliers. Pure arithmetic — no clock,
 * no DB, no NestJS — so a target can be recomputed and tested in isolation.
 *
 * The formula is four terms, so there is deliberately no third-party BMR
 * library.
 */

/** Sex is an enum, not a boolean: the intercept differs by 166 kcal. */
export const SEXES = ['male', 'female'] as const;
export type Sex = (typeof SEXES)[number];

/**
 * Named activity levels, declared as a value array so every consumer (the
 * factor map, the DTO) is keyed exhaustively — a level added here and not to
 * `ACTIVITY_FACTORS` below is a type error, never a runtime `undefined`.
 */
export const ACTIVITY_LEVELS = [
  'sedentary',
  'light',
  'moderate',
  'active',
  'veryActive',
] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

/** Everything the formula needs, and exactly what `PUT /api/target/profile` stores. */
export interface Profile {
  age: number;
  sex: Sex;
  heightCm: number;
  weightKg: number;
  activity: ActivityLevel;
}

/**
 * Activity multipliers are fixed named constants — not user-typed numbers.
 * The Harris-Benedict activity table, rounded to three decimals.
 */
export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  veryActive: 1.9,
};

/**
 * Mifflin-St Jeor. Returns kcal/day at rest, before any activity multiplier.
 * Rounded to whole kcal — a stored target is never fractional.
 */
export function basalMetabolicRate(profile: Profile): number {
  const base = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.age;
  return Math.round(base + (profile.sex === 'male' ? 5 : -161));
}

/** TDEE: what the profile actually burns in a day. */
export function totalDailyEnergyExpenditure(profile: Profile): number {
  return Math.round(basalMetabolicRate(profile) * ACTIVITY_FACTORS[profile.activity]);
}
