import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_PAGE_LIMIT } from '@life/service-kit';
import { PLANNED_MIN_MINUTES, PLANNED_MAX_MINUTES } from '../settings/goal.js';
import { SITTING_OUTCOMES, type SittingOutcome } from './sitting-minutes.js';

/**
 * Client-local day, `YYYY-MM-DD` and nothing else — the same rule focus-service's session
 * DTOs enforce, restated here because a service never imports another service's source
 * (arch-check RULE 5).
 *
 * An ISO-8601 check alone accepts `2026-11`, `20261114` and `2026-11-14T06:00:00Z`, and
 * `daysBetween` reads the day by appending a midnight to it: a month would widen the
 * window to the first of it, a timestamp would parse to nothing and serve an empty window.
 * Validating the shape this service actually means is what keeps a wrong answer from
 * arriving as a 200.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A day string is exactly ten characters; the regex is the shape rule, this the cap. */
const SESSION_DATE_MAX = 10;

/**
 * `GET /sessions?limit=&cursor=`: the sitting log's paging window.
 *
 * Neither value is part of any fetch identity: the log's read is one unbounded entry, so a
 * page is a projection after one cache-or-database read and never a second fetch
 * (`## Cache Rules`, Contract 2 Rule 3).
 */
export class ListSittingsQuery {
  // The cap is imported, never restated: a second copy would be a place for it to drift
  // from the paging seam's own clamp.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}

/**
 * `GET /sessions/days?from=&to=`: the closed window of client-local days to measure.
 *
 * The two bounds are the window's fetch identity and the whole of its cache key
 * (`meditation:<sub>:v<gen>:sessions:<from>:<to>`): one entry serves every day of that
 * window, and no filter, cursor or limit joins them (`## Cache Rules`, Contract 2 Rule 3).
 */
export class ListDaysQuery {
  @IsString()
  @MaxLength(SESSION_DATE_MAX)
  @Matches(DATE_ONLY)
  from: string;

  @IsString()
  @MaxLength(SESSION_DATE_MAX)
  @Matches(DATE_ONLY)
  to: string;
}

/**
 * Body of `POST /sessions`: one finished sitting, reported as it happened.
 *
 * `ownerSub` is deliberately absent, and the global `forbidNonWhitelisted` pipe rejects
 * a body carrying it — ownership comes from `@Principal()` only. The minutes are *not*
 * in this body either: the client reports how long it sat, and `recordedSitting` decides
 * what gets stored, so a caller cannot ask for minutes it did not sit.
 */
export class CreateSittingDto {
  /**
   * The client's own local day, `YYYY-MM-DD`; the window read filters on it, and no
   * clock here ever derives one — a sitting belongs to the day it ended in, in the
   * timezone the client is actually sitting in (`SPEC-meditation-app` §9 assumption 3).
   *
   * The same day-only shape as the window bounds, and for the same reason: `day` is what
   * the window read filters on, so a month or a timestamp written here would be a row that
   * no day-done read can ever count.
   */
  @IsString()
  @MaxLength(SESSION_DATE_MAX)
  @Matches(DATE_ONLY)
  day: string;

  @IsISO8601()
  startedAt: string;

  @IsISO8601()
  endedAt: string;

  /** The length the sitting was planned for: 5 minutes to a day, the range the app offers. */
  @IsInt()
  @Min(PLANNED_MIN_MINUTES)
  @Max(PLANNED_MAX_MINUTES)
  plannedMinutes: number;

  /** Seconds actually sat; fractions are refused, so the rounding is the server's. */
  @IsInt()
  @Min(0)
  elapsedSeconds: number;

  /**
   * How it ended. A natural finish stores the planned length; a keep stores what was
   * sat. An abandoned sitting sends nothing at all, so there is no third value here.
   */
  @IsIn(SITTING_OUTCOMES)
  outcome: SittingOutcome;
}
