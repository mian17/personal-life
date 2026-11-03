import type { FeedbackStatus } from '@life/shared';

/**
 * The status vocabulary the inbox renders: each wire value carries its human
 * label and its pill's semantic token in one row, so the dropdown and the pill
 * read one source. Each token is a hue `tokens.css` declares, never a new color.
 */
export type FeedbackStatusToken = '--ink-2' | '--warn' | '--ok' | '--ink-3';

export interface FeedbackStatusOption {
  value: FeedbackStatus;
  label: string;
  token: FeedbackStatusToken;
}

export const FEEDBACK_STATUSES: readonly FeedbackStatusOption[] = [
  { value: 'open', label: 'Open', token: '--ink-2' },
  { value: 'in_progress', label: 'In Progress', token: '--warn' },
  { value: 'done', label: 'Done', token: '--ok' },
  { value: 'wont_do', label: "Won't Do", token: '--ink-3' },
];

export function feedbackStatusOption(status: FeedbackStatus): FeedbackStatusOption {
  const option = FEEDBACK_STATUSES.find((candidate) => candidate.value === status);
  if (option === undefined) throw new RangeError(`Unknown feedback status: ${status}`);
  return option;
}
