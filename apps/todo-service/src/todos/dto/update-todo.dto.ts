import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { TODO_TITLE_MAX, TODO_NOTE_MAX } from '@life/shared';
import { DATE_ONLY } from './create-todo.dto';

/**
 * PATCH body. An omitted field is left unchanged (last-write-wins). For the
 * nullable fields (`note`, `dueDate`, `listId`) an explicit JSON `null` means
 * "clear": `note` → no note, `dueDate` → undated, `listId` → detach from list.
 * A `tagIds` array REPLACES the association set (kernel detach semantics).
 */
export class UpdateTodoDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(TODO_TITLE_MAX)
  title?: string;

  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(TODO_NOTE_MAX)
  note?: string | null;

  @IsOptional()
  @IsBoolean()
  done?: boolean;

  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(10)
  dueDate?: string | null;

  /** `null` = clear the override back to inherit (`SPEC-todo-importance`). */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsBoolean()
  important?: boolean | null;

  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(64)
  listId?: string | null;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  tagIds?: number[];

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}
