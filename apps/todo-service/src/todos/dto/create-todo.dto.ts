import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { TODO_TITLE_MAX, TODO_NOTE_MAX, TODO_REPEATS } from '@life/shared';
import type { TodoRepeat } from '@life/shared';
import { ISO_DUE } from '../due-time';

/** `YYYY-MM-DD` — the wire form of the plaintext `dueDate` metadata column. */
export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateTodoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(TODO_TITLE_MAX)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(TODO_NOTE_MAX)
  note?: string;

  @IsOptional()
  @IsString()
  @Matches(ISO_DUE)
  dueDate?: string;

  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsIn(TODO_REPEATS)
  repeat?: TodoRepeat | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  listId?: string;

  /** `null` = inherit the list default (`SPEC-todo-importance`). */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsBoolean()
  important?: boolean | null;

  // TagRef ids (registry-owned, `tags-service`). todo-service stores exactly
  // these ids (no names, no registry call); the app resolves names.
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  tagIds?: number[];
}
