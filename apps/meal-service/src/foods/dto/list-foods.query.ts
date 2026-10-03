import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * The `GET /api/foods?q=` surface. `q` is a content filter over the **decrypted**
 * food names, applied in memory after the cache hit; it is never part of the
 * fetch identity, so it stays out of the cache key (`SPEC-meal-service` Cache
 * Rules: one entry serves every search variant).
 */
export class ListFoodsQuery {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}
