/**
 * The sitting-minute arithmetic (`SPEC-meditation-app` §1, §9 assumption 10): a
 * natural finish records the length it was planned for, an early keep records
 * `min(ceil(elapsedMin), plannedMinutes)` with a floor of 1, and nothing can record more
 * than it was planned for.
 *
 * Rounding up is the honest direction for a sitting — a minute begun is a minute sat —
 * so thirty elapsed seconds against a fifteen-minute sitting records one minute rather
 * than zero, and ten minutes against fifteen records ten.
 */

/** How a sitting ended: on its own planned length, or stopped early and kept. */
export const SITTING_OUTCOMES = ['finished', 'kept'] as const;
export type SittingOutcome = (typeof SITTING_OUTCOMES)[number];

/** A sitting as the client reports it, before any rounding is applied. */
export interface SittingDraft {
  /** The client's own local day, `YYYY-MM-DD` — this service never derives one. */
  day: string;
  startedAt: string;
  endedAt: string;
  plannedMinutes: number;
  elapsedSeconds: number;
  outcome: SittingOutcome;
}

/** The measurable part of a sitting, which is what the envelope seals. */
export interface SittingContent {
  startedAt: string;
  endedAt: string;
  plannedMinutes: number;
  minutes: number;
  completed: boolean;
}

/** The minutes a sitting is recorded with, decided by how it ended. */
export function recordedSitting(draft: SittingDraft): SittingContent {
  const minutes =
    draft.outcome === 'finished'
      ? draft.plannedMinutes
      : keptMinutes(draft.elapsedSeconds, draft.plannedMinutes);

  return {
    startedAt: draft.startedAt,
    endedAt: draft.endedAt,
    plannedMinutes: draft.plannedMinutes,
    minutes,
    completed: draft.outcome === 'finished',
  };
}

/** Minutes actually sat: the elapsed time rounded up, never below one, never past planned. */
export function keptMinutes(elapsedSeconds: number, plannedMinutes: number): number {
  const elapsedMinutes = Math.ceil(elapsedSeconds / 60);
  return Math.min(Math.max(elapsedMinutes, 1), plannedMinutes);
}
