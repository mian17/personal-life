import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * The `GET /api/foods?q=&includeDeleted=` surface. `q` is a content filter
 * over the **decrypted** food names, applied in memory after the cache hit; it
 * is never part of the fetch identity, so it stays out of the cache key
 * (`SPEC-meal-service` Cache Rules: one entry serves every search variant).
 *
 * `includeDeleted` narrows the *fetch identity* instead: past entries and
 * saved-meal items resolve their dish name against the owner's whole catalog
 * (soft-deleted rows included), so the read cannot filter them in memory — the
 * loader itself must collect them (the loader condition is the key predicate,
 * and the condition is one `IsNull()`).
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
}
