import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { TODO_LIST_NAME_MAX } from '@life/shared';

export class CreateListDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(TODO_LIST_NAME_MAX)
  name: string;

  /** `null` = false (the list's default for inheriting todos). */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsBoolean()
  importantDefault?: boolean | null;
}
