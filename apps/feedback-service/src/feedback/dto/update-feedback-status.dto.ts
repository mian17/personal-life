import { IsIn } from 'class-validator';
import { FEEDBACK_STATUS_VALUES, type FeedbackStatus } from '@life/shared';

/**
 * The `PATCH /api/feedback/:id` body (`SPEC-feedback-status` API / DTO
 * contract). `status` is the fixed vocabulary `@life/shared` owns, so the DB
 * CHECK and this `@IsIn` read one constant and can never drift (lesson 0016).
 *
 * An invalid value is a `400` (the kernel's global `ValidationPipe`); the
 * service never answers `422`, and this is the route's only validation status.
 * The owner is never part of the body — it comes from `principal.sub`.
 */
export class UpdateFeedbackStatusDto {
  @IsIn(FEEDBACK_STATUS_VALUES)
  status: FeedbackStatus;
}
