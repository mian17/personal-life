import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { TAG_NAME_MAX } from '@life/shared';

/** `POST /api/tags {name}` — the only way tags come into existence. */
export class CreateTagDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(TAG_NAME_MAX)
  name: string;
}
