import { FEEDBACK_STATUS_VALUES } from '@life/shared';
import {
  FEEDBACK_STATUSES,
  feedbackStatusOption,
} from '../src/components/feedback-status';

const EXPECTED = [
  { value: 'open', label: 'Open', token: '--accent' },
  { value: 'in_progress', label: 'In Progress', token: '--amber' },
  { value: 'done', label: 'Done', token: '--green' },
  { value: 'wont_do', label: "Won't Do", token: '--muted' },
] as const;

describe('feedback status vocabulary', () => {
  it('covers every wire value exactly once', () => {
    expect(FEEDBACK_STATUSES.map((option) => option.value)).toEqual([
      ...FEEDBACK_STATUS_VALUES,
    ]);
  });

  it('maps each status to its label and semantic token', () => {
    expect(FEEDBACK_STATUSES.map(({ value, label, token }) => ({ value, label, token }))).toEqual(
      EXPECTED,
    );
  });

  it('gives the four statuses four distinct tokens', () => {
    const tokens = FEEDBACK_STATUSES.map((option) => option.token);
    expect(new Set(tokens).size).toBe(4);
  });

  // Each status hue's declaration is pinned once, by `tokens.test.ts`'s
  // "feedback status → revised token" block, which owns the legacy-to-revised rename.

  it('answers the option for a status and rejects an unknown one', () => {
    expect(feedbackStatusOption('done')).toEqual(EXPECTED[2]);
    expect(() => feedbackStatusOption('archived' as never)).toThrow(RangeError);
  });
});
