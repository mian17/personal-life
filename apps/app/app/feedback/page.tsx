import type { FeedbackStatus } from '@life/shared';
import { FEEDBACK_STATUS_VALUES } from '@life/shared';
import { listFeedbackPage } from '@/lib/feedback-api';
import { setFeedbackStatusAction, submitFeedbackAction } from '../feedback-actions';
import { FEEDBACK_PAGE_SIZE, FeedbackInbox } from '../feedback-inbox';

export const dynamic = 'force-dynamic';

/**
 * Parse a `status` search param against the shared vocabulary: absent or unknown
 * reads as All (`undefined`), so a hand-typed URL never asks for a status no entry
 * can carry (`parseTagId`'s rule for `/notes`).
 */
function parseFeedbackStatus(raw: string | undefined): FeedbackStatus | undefined {
  return FEEDBACK_STATUS_VALUES.find((status) => status === raw);
}

/**
 * The inbox's first page, read on the server (`SPEC-load-more`). Later pages are the
 * body's job, through the cursor this page hands down — the whole list is no longer
 * fetched up front, so an inbox that grows without bound costs one screenful to open.
 */
export default async function FeedbackPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ status?: string }>;
}>) {
  const { status } = await searchParams;
  const { feedback, nextCursor } = await listFeedbackPage({ limit: FEEDBACK_PAGE_SIZE });

  return (
    <FeedbackInbox
      entries={feedback}
      nextCursor={nextCursor}
      status={parseFeedbackStatus(status)}
      submitFeedbackAction={submitFeedbackAction}
      setFeedbackStatusAction={setFeedbackStatusAction}
    />
  );
}
