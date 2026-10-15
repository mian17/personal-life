import type { FeedbackType } from '@life/shared';

export const FEEDBACK_TYPES: readonly { value: FeedbackType; label: string }[] = [
  { value: 'feature_request', label: 'Feature request' },
  { value: 'enhancement', label: 'Enhancement' },
  { value: 'bug_report', label: 'Bug report' },
] as const;
