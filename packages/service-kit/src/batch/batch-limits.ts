/**
 * The one batch size rule (`SPEC-batch-receiver.md` §5.1).
 *
 * The cap lives here and nowhere else: a service's batch DTO validates shape
 * only, so a count is rejected in exactly one place — before any transaction
 * opens, which is why a rejected request touches no database at all.
 */
import { BadRequestException } from '@nestjs/common';

/** The most items one batch may carry. */
export const MAX_BATCH_ITEMS = 10;

/** Throws a `400` naming the cap unless the batch holds 1..`MAX_BATCH_ITEMS` items. */
export function assertBatchSize(items: readonly unknown[]): void {
  if (items.length >= 1 && items.length <= MAX_BATCH_ITEMS) return;

  throw new BadRequestException(
    `A batch must contain between 1 and ${MAX_BATCH_ITEMS} items`,
  );
}
