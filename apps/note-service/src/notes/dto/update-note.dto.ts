import { Transform } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  IsNotEmpty,
  Min,
} from 'class-validator';
import { NOTE_BODY_MAX } from '@life/shared';

export class UpdateNoteDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(NOTE_BODY_MAX)
  body?: string;

  // TagRef ids (registry-owned). Omitting the field leaves associations
  // untouched; sending an array REPLACES the set (kernel detach semantics).
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  tagIds?: number[];

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}
