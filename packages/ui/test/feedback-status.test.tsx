import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FEEDBACK_STATUS_VALUES } from '@life/shared';
import {
  FEEDBACK_STATUSES,
  feedbackStatusOption,
} from '../src/components/feedback-status';

const tokensCss = readFileSync(join(__dirname, '..', 'src', 'styles', 'tokens.css'), 'utf8');

const EXPECTED = [
  { value: 'open', label: 'Open', token: '--ink-2' },
  { value: 'in_progress', label: 'In Progress', token: '--warn' },
  { value: 'done', label: 'Done', token: '--ok' },
  { value: 'wont_do', label: "Won't Do", token: '--ink-3' },
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

  it('pins each mapped token to a token declared in tokens.css', () => {
    for (const { token } of FEEDBACK_STATUSES) {
      expect(tokensCss).toContain(`${token}:`);
    }
  });

  it('answers the option for a status and rejects an unknown one', () => {
    expect(feedbackStatusOption('done')).toEqual(EXPECTED[2]);
    expect(() => feedbackStatusOption('archived' as never)).toThrow(RangeError);
  });
});
