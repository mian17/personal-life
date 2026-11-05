import type { FeedbackType } from '@life/shared';

/**
 * `label` is the stored domain name the inbox headings render; `shortLabel` is the one word the
 * sheet's segmented trough can fit at 375px.
 */
export const FEEDBACK_TYPES: readonly { value: FeedbackType; label: string; shortLabel: string }[] =
  [
    { value: 'feature_request', label: 'Feature request', shortLabel: 'Feature' },
    { value: 'enhancement', label: 'Enhancement', shortLabel: 'Enhancement' },
    { value: 'bug_report', label: 'Bug report', shortLabel: 'Bug' },
  ] as const;
