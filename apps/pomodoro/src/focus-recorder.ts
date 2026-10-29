'use client';

import { useEffect, useRef } from 'react';
import { MINUTE_MS, type Durations, type Phase, type Status } from './timer';

/** What a recorded block is read from: which phase, how long it runs, how much of it is left. */
export interface FocusBlock {
  phase: Phase;
  durations: Durations;
  remainingMs: number;
}

/** A block plus where the machine stands, which is what tells a finished block from an abandoned one. */
export interface FocusBlockState extends FocusBlock {
  status: Status;
}

/**
 * Whole minutes the owner counted in this phase. `remainingMs` is the machine's
 * own remaining, so time spent paused — frozen out of it — never counts; a
 * part-minute is dropped because the day stores minutes; a break is no block.
 */
export function focusBlockMinutes({ phase, durations, remainingMs }: FocusBlock): number {
  if (phase !== 'focus') return 0;

  const countedMs = durations.focus * MINUTE_MS - remainingMs;
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

/** Reset drops a stopped focus phase back to the untouched start, so that phase is the block it ends. */
function ownerResetMidFocus(previous: FocusBlockState, current: FocusBlockState): boolean {
  return (
    previous.phase === 'focus' &&
    previous.status !== 'boundary' &&
    current.phase === 'focus' &&
    current.status === 'idle'
  );
}
