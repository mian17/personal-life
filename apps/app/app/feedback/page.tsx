import { settingsHref } from '@life/app-kit';
import { listFeedback } from '@/lib/feedback-api';
import { setFeedbackStatusAction, submitFeedbackAction } from '../feedback-actions';
import { FeedbackInbox } from '../feedback-inbox';

export const dynamic = 'force-dynamic';

export default async function FeedbackPage() {
  const entries = await listFeedback();
  return (
    <FeedbackInbox
      entries={entries}
      settingsHref={settingsHref('/feedback')}
      submitFeedbackAction={submitFeedbackAction}
      setFeedbackStatusAction={setFeedbackStatusAction}
    />
  );
}