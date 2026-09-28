import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { TODO_LIST_NAME_MAX } from '@life/shared';

export class UpdateListDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(TODO_LIST_NAME_MAX)
  name: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}
