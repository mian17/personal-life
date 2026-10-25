import { IsArray, IsInt, IsOptional, IsString, MaxLength, IsNotEmpty } from 'class-validator';
import { NOTE_BODY_MAX } from '@life/shared';

export class CreateNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(NOTE_BODY_MAX)
  body: string;

  // TagRef ids (registry-owned). note-service stores exactly these ids; the app
  // resolves names through `tags-service` before writing (MAP M4).
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  tagIds: number[] = [];
}
