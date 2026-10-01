import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { TODO_LIST_NAME_MAX } from '@life/shared';

export class UpdateListDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(TODO_LIST_NAME_MAX)
  name: string;

  /** `null` = false (clear the default); omitting leaves it unchanged. */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsBoolean()
  importantDefault?: boolean | null;

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}
