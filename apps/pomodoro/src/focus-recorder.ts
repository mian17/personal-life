'use client';

import { useEffect, useRef } from 'react';
import { MINUTE_MS, type Phase, type Status } from './timer';

/** What a recorded block is read from: which phase, how long it was started for, how much of it is left. */
export interface FocusBlock {
  phase: Phase;
  /** The length this phase began with, which is the only base its minutes may be read against. */
  startedPhaseMs: number;
  remainingMs: number;
}

/** A block plus where the machine stands, which is what tells a finished block from an abandoned one. */
export interface FocusBlockState extends FocusBlock {
  status: Status;
}

/**
 * Whole minutes the owner counted in this phase. Both sides of the subtraction come from
 * the length the phase was started with, so a length retuned mid-phase — the focus chips
 * do exactly that — cannot turn three focused minutes into twenty-eight: a configuration
 * change is not progress. `remainingMs` is the machine's own remaining, so time spent
 * paused — frozen out of it — never counts; a part-minute is dropped because the day
 * stores minutes; a break is no block.
 */
export function focusBlockMinutes({ phase, startedPhaseMs, remainingMs }: FocusBlock): number {
  if (phase !== 'focus') return 0;

  const countedMs = startedPhaseMs - remainingMs;
  return Math.max(0, Math.floor(countedMs / MINUTE_MS));
}

/** Fires once per focus block that ends — at its boundary, or when the owner stops and resets it. */
export function useFocusRecorded(
  state: FocusBlockState,
  onBlockEnd?: (minutes: number) => void,
): void {
  const previous = useRef(state);

  useEffect(() => {
    const minutesEnded = minutesEndedBetween(previous.current, state);
    previous.current = state;
    if (minutesEnded < 1 || !onBlockEnd) return;

    onBlockEnd(minutesEnded);
  }, [state, onBlockEnd]);
}

function minutesEndedBetween(previous: FocusBlockState, current: FocusBlockState): number {
  if (reachedBoundary(previous, current)) return focusBlockMinutes({ ...current, remainingMs: 0 });
  if (ownerResetMidFocus(previous, current)) return focusBlockMinutes(previous);
  return 0;
}

/**
 * Settling on a focus boundary means the whole phase counted, however often it was
 * paused on the way. A phase only settles from `running`, so a boundary the mount
 * restored — from `idle` — is one an earlier page already reported.
 */
function reachedBoundary(previous: FocusBlockState, current: FocusBlockState): boolean {
  if (previous.status === 'idle' || previous.status === 'boundary') return false;
  return current.phase === 'focus' && current.status === 'boundary';
}

/**
 * Reset drops a focus phase that had actually begun back to the untouched start, so that
 * phase is the block it ends. `idle` is the untouched start itself — nothing ran, so
 * nothing is owed, however the lengths around it changed.
 */
function ownerResetMidFocus(previous: FocusBlockState, current: FocusBlockState): boolean {
  if (previous.status !== 'running' && previous.status !== 'paused') return false;
  return current.phase === 'focus' && current.status === 'idle';
}
