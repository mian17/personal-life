import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { MAX_PAGE_LIMIT } from '@life/service-kit';

/**
 * `GET /api/tags` query (`SPEC-pagination-seam` §3): how many tags, where the page
 * starts, and an optional name filter.
 *
 * The tag vocabulary is hand-curated — tens of rows — so this window buys the
 * shared list contract rather than a faster read. The cap is imported from the
 * seam, never restated: a literal here would be a second place for it to drift.
 *
 * `q` filters over the **decrypted** name after the cache hit, so it never enters
 * the cache key (`tags:<sub>:v<gen>:all` serves every search variant).
 */
export class ListTagsQuery {
  /** Case-insensitive substring of the tag name; blank means no filter. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

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
