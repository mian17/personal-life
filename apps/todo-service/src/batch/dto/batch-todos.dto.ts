import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { CreateTodoDto } from '../../todos/dto/create-todo.dto.js';
import { UpdateTodoDto } from '../../todos/dto/update-todo.dto.js';
import { CreateListDto } from '../../lists/dto/create-list.dto.js';
import { UpdateListDto } from '../../lists/dto/update-list.dto.js';

/**
 * Batch request bodies (`SPEC-todo-service.md` §5): one wildcard body per kind,
 * each holding an `items` array whose items are the singular DTO's shape, so a
 * batch accepts exactly what its singular twin accepts.
 *
 * No count rule appears here on purpose. `MAX_BATCH_ITEMS` lives in the batch
 * kernel, which rejects an out-of-range count before any transaction opens — a
 * duplicate limit would be a second place for the cap to drift.
 */

export class BatchUpdateTodoItem extends UpdateTodoDto {
  @IsString()
  @IsNotEmpty()
  id: string;
}

export class BatchDeleteTodoItem {
  @IsString()
  @IsNotEmpty()
  id: string;
}

export class BatchUpdateListItem extends UpdateListDto {
  @IsString()
  @IsNotEmpty()
  id: string;
}

export class BatchCreateTodosDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTodoDto)
  items: CreateTodoDto[];
}

export class BatchUpdateTodosDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchUpdateTodoItem)
  items: BatchUpdateTodoItem[];
}

export class BatchDeleteTodosDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchDeleteTodoItem)
  items: BatchDeleteTodoItem[];
}

export class BatchCreateListsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateListDto)
  items: CreateListDto[];
}

export class BatchUpdateListsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchUpdateListItem)
  items: BatchUpdateListItem[];
}
