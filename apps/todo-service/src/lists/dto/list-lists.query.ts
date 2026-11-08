import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { MAX_PAGE_LIMIT } from '@life/service-kit';

/**
 * `GET /api/lists` query (`SPEC-pagination-seam` §3): how many lists, where the
 * page starts, and an optional name filter.
 *
 * A named list vocabulary is tens of rows, so this window buys the shared list
 * contract rather than a faster read. The cap is imported from the seam, never
 * restated: a literal here would be a second place for it to drift.
 *
 * `q` filters over the **decrypted** name after the cache hit, so it never enters
 * the cache key (`todo:<sub>:v<gen>:lists` serves every search variant).
 */
export class ListListsQuery {
  /** Case-insensitive substring of the list name; blank means no filter. */
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
