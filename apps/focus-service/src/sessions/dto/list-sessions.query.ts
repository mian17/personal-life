import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { MAX_PAGE_LIMIT } from '@life/service-kit';
import { DATE_ONLY, SESSION_DATE_MAX } from './session-rules.js';

/**
 * `GET /api/sessions?from=&to=&limit=&cursor=`: both bounds required, both
 * client-passed days, plus the shared paging window.
 *
 * The range is part of the fetch identity (it sits in the cache key); the paging
 * window is not — one cached range serves every page of itself, so `limit` and
 * `cursor` stay out of the key (`SPEC-focus-service` Cache Rules).
 */
export class ListSessionsQuery {
  @IsString()
  @MaxLength(SESSION_DATE_MAX)
  @Matches(DATE_ONLY)
  from: string;

  @IsString()
  @MaxLength(SESSION_DATE_MAX)
  @Matches(DATE_ONLY)
  to: string;

  // The cap is imported, never restated: a second copy would be a place for it to
  // drift from the seam's own clamp.
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
