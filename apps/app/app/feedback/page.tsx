import { listFeedback } from '@/lib/feedback-api';
import { submitFeedbackAction } from '../feedback-actions';
import { FeedbackInbox } from '../feedback-inbox';

export const dynamic = 'force-dynamic';

export default async function FeedbackPage() {
  const entries = await listFeedback();
  return <FeedbackInbox entries={entries} submitFeedbackAction={submitFeedbackAction} />;
}