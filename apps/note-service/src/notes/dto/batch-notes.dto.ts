import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { CreateNoteDto } from './create-note.dto';
import { UpdateNoteDto } from './update-note.dto';

/**
 * Batch request bodies (`SPEC-note-service.md` §5): one wildcard body per kind,
 * each holding an `items` array whose items are the singular DTO's shape, so a
 * batch accepts exactly what its singular twin accepts.
 *
 * No count rule appears here on purpose. `MAX_BATCH_ITEMS` lives in the batch
 * kernel, which rejects an out-of-range count before any transaction opens — a
 * duplicate limit would be a second place for the cap to drift.
 */

export class BatchUpdateNoteItem extends UpdateNoteDto {
  @IsString()
  @IsNotEmpty()
  id: string;
}

export class BatchDeleteNoteItem {
  @IsString()
  @IsNotEmpty()
  id: string;
}

export class BatchCreateNotesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateNoteDto)
  items: CreateNoteDto[];
}

export class BatchUpdateNotesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchUpdateNoteItem)
  items: BatchUpdateNoteItem[];
}

export class BatchDeleteNotesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchDeleteNoteItem)
  items: BatchDeleteNoteItem[];
}
