import { Transform } from 'class-transformer';
import {
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  IsNotEmpty,
  IsInt,
  Min,
} from 'class-validator';
import { NOTE_BODY_MAX, TAG_NAME_MAX } from '@life/shared';

export class UpdateNoteDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(NOTE_BODY_MAX)
  body?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(TAG_NAME_MAX, { each: true })
  tags?: string[];

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}
