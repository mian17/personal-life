import {
  keptMinutes,
  recordedSitting,
  type SittingDraft,
} from '../src/sessions/sitting-minutes.js';

/**
 * The sitting-minute arithmetic (`SPEC-meditation-app` §1, §9 assumption 10) at its exact
 * edges: a natural finish records the planned length, an early keep records
 * `min(ceil(elapsedMin), plannedMinutes)` with a floor of 1, and nothing records more than
 * the sitting was planned for.
 */

/** A fifteen-minute sitting that ran for `elapsedSeconds` and was stopped early and kept. */
function keptAfter(elapsedSeconds: number, plannedMinutes = 15): SittingDraft {
  return {
    day: '2026-11-16',
    startedAt: '2026-11-16T06:00:00.000Z',
    endedAt: '2026-11-16T06:10:00.000Z',
    plannedMinutes,
    elapsedSeconds,
    outcome: 'kept',
  };
}

/** The same fifteen-minute sitting, finished on its own planned length. */
function finished(plannedMinutes = 15): SittingDraft {
  return {
    ...keptAfter(plannedMinutes * 60, plannedMinutes),
    elapsedSeconds: plannedMinutes * 60,
    outcome: 'finished',
  };
}

describe('recordedSitting', () => {
  it('stores the planned minutes and completed true on a natural finish', () => {
    expect(recordedSitting(finished(20))).toMatchObject({
      plannedMinutes: 20,
      minutes: 20,
      completed: true,
    });
  });

  it('stores the planned minutes however long a natural finish reports running', () => {
    const ranLong = { ...finished(15), elapsedSeconds: 15 * 60 + 40 };

    expect(recordedSitting(ranLong)).toMatchObject({ minutes: 15, completed: true });
  });

  it('records one minute for thirty elapsed seconds kept against a fifteen-minute sitting', () => {
    expect(recordedSitting(keptAfter(30))).toMatchObject({
      plannedMinutes: 15,
      minutes: 1,
      completed: false,
    });
  });

  it('records ten minutes for ten elapsed minutes kept against fifteen planned', () => {
    expect(recordedSitting(keptAfter(600))).toMatchObject({ minutes: 10, completed: false });
  });

  it('keeps the timestamps the client reported', () => {
    expect(recordedSitting(keptAfter(600))).toMatchObject({
      startedAt: '2026-11-16T06:00:00.000Z',
      endedAt: '2026-11-16T06:10:00.000Z',
    });
  });
});

describe('keptMinutes', () => {
  it('rounds a part-minute up, so a minute begun is a minute sat', () => {
    expect(keptMinutes(1, 15)).toBe(1);
    expect(keptMinutes(59, 15)).toBe(1);
    expect(keptMinutes(60, 15)).toBe(1);
    expect(keptMinutes(61, 15)).toBe(2);
  });

  it('never records less than one minute, even with nothing elapsed', () => {
    expect(keptMinutes(0, 15)).toBe(1);
  });

  it('never records more than the planned minutes', () => {
    expect(keptMinutes(15 * 60, 15)).toBe(15);
    expect(keptMinutes(15 * 60 + 1, 15)).toBe(15);
    expect(keptMinutes(60 * 60, 15)).toBe(15);
  });

  it('caps a one-minute sitting at its own planned length', () => {
    expect(keptMinutes(600, 1)).toBe(1);
  });
});
