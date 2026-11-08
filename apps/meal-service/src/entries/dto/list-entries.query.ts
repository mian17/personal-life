import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { MAX_PAGE_LIMIT } from '@life/service-kit';
import { DATE_ONLY } from '../../targets/dto/update-profile.dto';
import { ENTRY_DATE_MAX, MEAL_GROUPS, MealGroup } from './create-entry.dto';

/**
 * The `GET /api/entries?date=&meal=&limit=&cursor=` surface. `date` is part of the
 * fetch identity (one entry set per day per owner, in the cache key); `meal` is a
 * content filter over the decrypted rows, applied in memory after the cache
 * hit and never in SQL (`SPEC-meal-service` Cache Rules: a meal-group filter
 * is applied post-hit, in memory, after decrypt).
 *
 * `limit`/`cursor` page the day post-hit and never enter the key. They are a
 * **uniform surface, not a performance fix**: a single day is already bounded
 * by the required `date` — which stays required, because one entry set per day
 * per owner is the fetch identity, not a filter. Every meal list pages so a
 * client sees one list contract; the bound here comes from the date query.
 */
export class ListEntriesQuery {
  /** Client-local `YYYY-MM-DD`. Required: the day is always the client's (lesson 0019). */
  @IsString()
  @MaxLength(ENTRY_DATE_MAX)
  @Matches(DATE_ONLY)
  date: string;

  @IsOptional()
  @IsIn(MEAL_GROUPS)
  meal?: MealGroup;

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