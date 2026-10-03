import { IsIn, IsInt, IsNumber, IsString, Matches, Max, Min } from 'class-validator';
import { ACTIVITY_LEVELS, SEXES } from '../target-calculator';
import { GOALS, type Goal } from '../target';
import type { ActivityLevel, Sex } from '../target-calculator';

/**
 * `YYYY-MM-DD` — the wire form of `validFrom` and of `GET /api/target?date=`.
 * Read as calendar parts, never via `new Date()`/`toLocale*` (lesson 0003/0019).
 */
export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Body of `PUT /api/target/profile` — exactly the profile INPUTS plus the
 * client's `validFrom` day. The computed kcal/BMR/TDEE/macro grams are
 * deliberately absent, so the global `forbidNonWhitelisted` pipe
 * (`SPEC-target-onboarding` Code Style) rejects any body that carries them.
 * Derived entirely server-side by `calculateTarget` ("Never: let the client
 * send computed kcal").
 */
export class UpdateProfileDto {
  @IsInt()
  @Min(1)
  @Max(130)
  age: number;

  @IsIn(SEXES)
  sex: Sex;

  @IsNumber()
  @Min(50)
  @Max(260)
  heightCm: number;

  @IsNumber()
  @Min(20)
  @Max(500)
  weightKg: number;

  @IsIn(ACTIVITY_LEVELS)
  activity: ActivityLevel;

  @IsIn(GOALS)
  goal: Goal;

  /**
   * The client-local day this version takes effect on. Required: the caller's
   * own `YYYY-MM-DD`, resolved by the shared owner `apps/app/lib/today.ts`
   * (`getToday()`). The service never reads its own clock for "today"
   * (lesson 0019, and the plan's governing decision "Today is the client's
   * zone"), so the field cannot be defaulted server-side.
   */
  @IsString()
  @Matches(DATE_ONLY)
  date: string;
}
