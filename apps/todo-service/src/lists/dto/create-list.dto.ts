import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { TODO_LIST_NAME_MAX } from '@life/shared';

export class CreateListDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(TODO_LIST_NAME_MAX)
  name: string;
}
