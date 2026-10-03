import { IsIn, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import {
  FEEDBACK_APPS,
  FEEDBACK_DESCRIPTION_MAX,
  FEEDBACK_TYPE_VALUES,
  type FeedbackApp,
  type FeedbackType,
} from '@life/shared';

/**
 * The `POST /api/feedback` body (`SPEC-feedback-service` API / DTO contract),
 * mirroring `@life/shared`'s `CreateFeedbackInput` exactly as note-service
 * mirrors its shared input types. Wire types live in `@life/shared`; this class
 * only adds the Nest validation metadata. The owner is never part of the body
 * — it comes from `principal.sub`.
 *
 * A validation failure is a `400` (the kernel's global `ValidationPipe`); the
 * service never answers `422`.
 */
export class CreateFeedbackDto {
  @IsUUID('4')
  id: string;

  @IsString()
  @IsIn(FEEDBACK_APPS)
  app: FeedbackApp;

  @IsIn(FEEDBACK_TYPE_VALUES)
  type: FeedbackType;

  @IsNotEmpty()
  @MaxLength(FEEDBACK_DESCRIPTION_MAX)
  description: string;
}
