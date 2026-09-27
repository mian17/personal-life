import { IsArray, IsInt } from 'class-validator';

/** `POST /api/tags/resolve {ids}` — ids are integers owned by this registry (M2). */
export class ResolveTagsDto {
  @IsArray()
  @IsInt({ each: true })
  ids: number[];
}
