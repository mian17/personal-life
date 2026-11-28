/**
 * The idle screen's subtitle (`SPEC-meditation-app` §1, spec C4): the minutes done today, the goal
 * they face, and the two ways that line changes — the goal reached, and no goal set at all.
 *
 * The three branches are the whole contract: the line is the only place the daily goal appears on
 * the idle screen, so each shape is asserted verbatim.
 */
import { goalSubtitleLine } from '@/lib/meditation-clock';

describe('goalSubtitleLine', () => {
  it('names the minutes done and the goal they face', () => {
    expect(goalSubtitleLine({ liveMinutes: 15, goalMinutes: 30 })).toBe(
      "15 minutes done · Today's goal is 30 minutes",
    );
  });

  it('keeps a single minute singular on both clauses', () => {
    expect(goalSubtitleLine({ liveMinutes: 1, goalMinutes: 30 })).toBe(
      "1 minute done · Today's goal is 30 minutes",
    );
    expect(goalSubtitleLine({ liveMinutes: 1, goalMinutes: 1 })).toBe(
      "1 minute done · Today's goal is 1 minute ✓",
    );
  });

  it('appends a check once the day reaches its goal, and keeps it past the goal', () => {
    expect(goalSubtitleLine({ liveMinutes: 30, goalMinutes: 30 })).toBe(
      "30 minutes done · Today's goal is 30 minutes ✓",
    );
    expect(goalSubtitleLine({ liveMinutes: 45, goalMinutes: 30 })).toBe(
      "45 minutes done · Today's goal is 30 minutes ✓",
    );
  });

  it('drops the goal clause when the owner has no goal', () => {
    expect(goalSubtitleLine({ liveMinutes: 0, goalMinutes: 0 })).toBe('0 minutes done today');
    expect(goalSubtitleLine({ liveMinutes: 12, goalMinutes: 0 })).toBe('12 minutes done today');
    expect(goalSubtitleLine({ liveMinutes: 1, goalMinutes: 0 })).toBe('1 minute done today');
  });
});
