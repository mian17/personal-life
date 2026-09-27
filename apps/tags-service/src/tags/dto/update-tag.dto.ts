import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { TAG_NAME_MAX } from '@life/shared';

/** `PATCH /api/tags/:id {name, expectedVersion?}` — rename with optional OCC. */
export class UpdateTagDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(TAG_NAME_MAX)
  name: string;

  /** Omit = legacy last-write-wins (kernel concurrency contract). */
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}
