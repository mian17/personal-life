import type { FeedbackStatus } from '@life/shared';

/**
 * The status vocabulary the inbox renders: each wire value carries its human
 * label and its pill's semantic token in one row, so the dropdown and the pill
 * read one source. Tokens are frozen values — only existing `--accent` /
 * `--amber` / `--green` / `--muted` appear here, never a new color.
 */
export type FeedbackStatusToken = '--accent' | '--amber' | '--green' | '--muted';

export interface FeedbackStatusOption {
  value: FeedbackStatus;
  label: string;
  token: FeedbackStatusToken;
}

export const FEEDBACK_STATUSES: readonly FeedbackStatusOption[] = [
  { value: 'open', label: 'Open', token: '--accent' },
  { value: 'in_progress', label: 'In Progress', token: '--amber' },
  { value: 'done', label: 'Done', token: '--green' },
  { value: 'wont_do', label: "Won't Do", token: '--muted' },
];

export function feedbackStatusOption(status: FeedbackStatus): FeedbackStatusOption {
  const option = FEEDBACK_STATUSES.find((candidate) => candidate.value === status);
  if (option === undefined) throw new RangeError(`Unknown feedback status: ${status}`);
  return option;
}
