import { Type } from 'class-transformer';
import { IsDefined, IsNotEmpty, IsString, ValidateNested } from 'class-validator';

/** The nested `keys` of a `PushSubscribeInput` endpoint. */
export class PushSubscribeKeysDto {
  @IsString()
  @IsNotEmpty()
  p256dh: string;

  @IsString()
  @IsNotEmpty()
  auth: string;
}

/**
 * Wire form of the shared `PushSubscribeInput`. A decorated class is required:
 * the global `ValidationPipe({ whitelist, transform, forbidNonWhitelisted })`
 * cannot validate an erased TypeScript interface, so an interface-typed body
 * would accept arbitrary payloads.
 */
export class PushSubscribeDto {
  @IsString()
  @IsNotEmpty()
  endpoint: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => PushSubscribeKeysDto)
  keys: PushSubscribeKeysDto;
}

/** `DELETE /api/push/subscribe` body: the endpoint to remove. */
export class PushUnsubscribeDto {
  @IsString()
  @IsNotEmpty()
  endpoint: string;
}
