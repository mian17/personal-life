import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { MAX_PAGE_LIMIT } from '@life/service-kit';

/**
 * `GET /api/goal?limit=&cursor=`: one page of the owner's goal history, oldest
 * first. The whole history carries no fetch parameter of its own, so neither
 * `limit` nor `cursor` enters the cache key.
 *
 * The cap is imported from the seam, never restated, so the DTO and the seam's
 * clamp cannot disagree about where a page ends.
 */
export class ListGoalsQuery {
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
