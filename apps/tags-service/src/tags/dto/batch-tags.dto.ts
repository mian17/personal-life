import { Type } from 'class-transformer';
import { IsArray, IsInt, ValidateNested } from 'class-validator';
import { CreateTagDto } from './create-tag.dto';
import { UpdateTagDto } from './update-tag.dto';

/**
 * Batch request bodies (`SPEC-tags-service.md` §5): one wildcard body per kind,
 * each holding an `items` array whose items are the singular DTO's shape, so a
 * batch accepts exactly what its singular twin accepts.
 *
 * No count rule appears here on purpose. `MAX_BATCH_ITEMS` lives in the batch
 * kernel, which rejects an out-of-range count before any transaction opens — a
 * duplicate limit would be a second place for the cap to drift.
 */

/**
 * Tag ids are integers — the one resource in the initiative that does not use a
 * UUID — so the batch item validates an id the way the singular route's
 * `ParseIntPipe` does.
 */
export class BatchUpdateTagItem extends UpdateTagDto {
  @IsInt()
  id: number;
}

export class BatchCreateTagsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTagDto)
  items: CreateTagDto[];
}

export class BatchUpdateTagsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchUpdateTagItem)
  items: BatchUpdateTagItem[];
}
