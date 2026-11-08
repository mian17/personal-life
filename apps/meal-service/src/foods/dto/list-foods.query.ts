import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { MAX_PAGE_LIMIT } from '@life/service-kit';

/**
 * The `GET /api/foods?q=&includeDeleted=&limit=&cursor=` surface. `q` is a
 * content filter over the **decrypted** food names, applied in memory after the
 * cache hit; it is never part of the fetch identity, so it stays out of the
 * cache key (`SPEC-meal-service` Cache Rules: one entry serves every search
 * variant).
 *
 * `includeDeleted` narrows the *fetch identity* instead: past entries and
 * saved-meal items resolve their dish name against the owner's whole catalog
 * (soft-deleted rows included), so the read cannot filter them in memory — the
 * loader itself must collect them (the loader condition is the key predicate,
 * and the condition is one `IsNull()`).
 *
 * `limit`/`cursor` are the paging window, applied post-hit: the catalog is the
 * one meal list that grows without bound (append-only, one row per created
 * dish), so this is the list a screen pages (`docs/reports/pagination-
 * inventory.md` §3). `MAX_PAGE_LIMIT` is imported rather than restated so the
 * cap has one definition (`SPEC-pagination-seam` §5).
 */
export class ListFoodsQuery {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @Transform(({ value }) => value === '1' || value === 'true')
  @IsBoolean()
  includeDeleted?: boolean;

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
