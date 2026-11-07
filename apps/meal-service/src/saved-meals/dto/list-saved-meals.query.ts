import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { MAX_PAGE_LIMIT } from '@life/service-kit';

/**
 * The `GET /api/saved-meals?limit=&cursor=` surface. Saved meals carry no
 * filter — the list is the whole non-trashed set — so the only request
 * parameters are the paging window, applied after the cache hit and never part
 * of the key (`SPEC-meal-service` Cache Rules: one entry serves every page).
 *
 * `MAX_PAGE_LIMIT` is imported rather than restated so the cap has one
 * definition (`SPEC-pagination-seam` §5).
 */
export class ListSavedMealsQuery {
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
