import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { DATE_ONLY } from '../../targets/dto/update-profile.dto';
import { ENTRY_DATE_MAX, MEAL_GROUPS, MealGroup } from './create-entry.dto';

/**
 * The `GET /api/entries?date=&meal=` surface. `date` is part of the fetch
 * identity (one entry set per day per owner, in the cache key); `meal` is a
 * content filter over the decrypted rows, applied in memory after the cache
 * hit and never in SQL (`SPEC-meal-service` Cache Rules: a meal-group filter
 * is applied post-hit, in memory, after decrypt).
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
}