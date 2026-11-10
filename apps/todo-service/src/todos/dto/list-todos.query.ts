import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DATE_ONLY } from './create-todo.dto.js';

/**
 * `GET /api/todos` filters. All of these are applied in memory off the one
 * cached row-set (`todo:all`), so none of them enter the cache key.
 */
export class ListTodosQuery {
  /** Decrypted title+note substring, SQLite-LIKE parity via `likeMatch`. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  listId?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  tagId?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === '') return undefined;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  @IsBoolean()
  done?: boolean;

  /** Matched against the computed `effectiveImportant` (`SPEC-todo-importance`). */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === '') return undefined;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  @IsBoolean()
  important?: boolean;

  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY)
  dueBefore?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY)
  dueAfter?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}
