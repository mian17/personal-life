import type { FeedbackStatus } from '@life/shared';
import { FEEDBACK_STATUS_VALUES } from '@life/shared';
import { listFeedback } from '@/lib/feedback-api';
import { setFeedbackStatusAction, submitFeedbackAction } from '../feedback-actions';
import { FeedbackInbox } from '../feedback-inbox';

export const dynamic = 'force-dynamic';

/**
 * Parse a `status` search param against the shared vocabulary: absent or unknown
 * reads as All (`undefined`), so a hand-typed URL never asks for a status no entry
 * can carry (`parseTagId`'s rule for `/notes`).
 */
function parseFeedbackStatus(raw: string | undefined): FeedbackStatus | undefined {
  return FEEDBACK_STATUS_VALUES.find((status) => status === raw);
}

export default async function FeedbackPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ status?: string }>;
}>) {
  const { status } = await searchParams;
  const entries = await listFeedback();

  return (
    <FeedbackInbox
      entries={entries}
      status={parseFeedbackStatus(status)}
      submitFeedbackAction={submitFeedbackAction}
      setFeedbackStatusAction={setFeedbackStatusAction}
    />
  );
}
