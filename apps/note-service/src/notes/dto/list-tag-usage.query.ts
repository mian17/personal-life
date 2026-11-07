import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { MAX_PAGE_LIMIT } from '@life/service-kit';

/**
 * `GET /api/tags` (note-service, tag usage) query (`SPEC-pagination-seam` §3):
 * how many rows, and where the page starts.
 *
 * Tag usage is bounded by the owner's tag vocabulary — tens of rows — so this
 * window buys the shared list contract, not a smaller read. The cap is imported
 * from the seam rather than restated: a literal here would be a second place for
 * the one cap to drift.
 */
export class ListTagUsageQuery {
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
