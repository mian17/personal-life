import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { MAX_PAGE_LIMIT } from '@life/service-kit';

/**
 * `GET /api/feedback` query (`SPEC-pagination-seam` §3): how many rows, and where
 * the page starts. Both are optional — a request that names neither gets the first
 * page at the seam's default size.
 *
 * `@Max(MAX_PAGE_LIMIT)` reads the seam's cap rather than restating it: a literal
 * here would be a second place for the one cap to drift.
 */
export class ListFeedbackQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number;

  /** Opaque cursor a previous page returned; passed back untouched. */
  @IsOptional()
  @IsString()
  cursor?: string;
}
