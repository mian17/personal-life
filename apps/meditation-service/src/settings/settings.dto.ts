import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDivisibleBy,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { DEFAULT_GOAL_MINUTES } from './goal.js';

/**
 * The interval-bell bounds (`SPEC-meditation-app` §1): a start offset anywhere in a
 * day, an interval of one minute to a day in whole-minute steps, and 1–6 rings or
 * `null` for ring-until-the-sitting-ends. An out-of-bounds bell is refused (400)
 * rather than clamped — unlike the goal, a bell that cannot exist is a caller's bug,
 * not a preference.
 */
export const OFFSET_MAX_SEC = 23 * 60 * 60 + 59 * 60 + 59;
export const INTERVAL_MIN_SEC = 60;
export const INTERVAL_MAX_SEC = 1440 * 60;
export const INTERVAL_STEP_SEC = 60;
export const BELL_REPEAT_MIN = 1;
export const BELL_REPEAT_MAX = 6;

/** Where a fresh owner's bell interval starts: ten minutes, the design's opening schedule. */
export const INTERVAL_DEFAULT_SEC = 10 * 60;

/** The bell configuration as it is stored inside the settings envelope. */
export interface BellSettings {
  enabled: boolean;
  offsetSec: number;
  intervalSec: number;
  /** `null` rings until the sitting ends; a number caps the rings. */
  repeat: number | null;
}

/** A settings row's content as stored (inside the `enc.v1.` envelope). */
export interface SettingsContent {
  goalMinutes: number;
  plannedMinutes: number;
  bells: BellSettings;
}

/** Where a fresh owner starts: a fifteen-minute goal and planned length, bells off. */
export const DEFAULT_SETTINGS: SettingsContent = {
  goalMinutes: DEFAULT_GOAL_MINUTES,
  plannedMinutes: DEFAULT_GOAL_MINUTES,
  bells: { enabled: false, offsetSec: 0, intervalSec: INTERVAL_DEFAULT_SEC, repeat: null },
};

export class BellsDto {
  @IsBoolean()
  enabled: boolean;

  /** Seconds into the sitting the first bowl lands; 0–23:59:59. */
  @IsInt()
  @Min(0)
  @Max(OFFSET_MAX_SEC)
  offsetSec: number;

  /** Seconds between bowls: one minute to a day, whole-minute steps. */
  @IsInt()
  @Min(INTERVAL_MIN_SEC)
  @Max(INTERVAL_MAX_SEC)
  @IsDivisibleBy(INTERVAL_STEP_SEC)
  intervalSec: number;

  /** How many bowls, or `null` for ring-until-the-end; a missing value is refused. */
  @ValidateIf((bells: BellsDto) => bells.repeat !== null)
  @IsInt()
  @Min(BELL_REPEAT_MIN)
  @Max(BELL_REPEAT_MAX)
  repeat: number | null;
}

/**
 * Body of `PUT /settings`, and the whole body `GET /settings` answers with.
 * `ownerSub` is deliberately absent, so the global `forbidNonWhitelisted` pipe rejects
 * a body carrying it: ownership comes from `@Principal()` only.
 *
 * Both minutes fields accept any non-negative whole number and are clamped into
 * range on the way in, so 7 is stored as 15 and 495 as 480 instead of being refused.
 * A negative length is the one thing that cannot mean anything.
 */
export class SettingsDto {
  @IsInt()
  @Min(0)
  goalMinutes: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  plannedMinutes?: number;

  @ValidateNested()
  @Type(() => BellsDto)
  bells: BellsDto;
}
