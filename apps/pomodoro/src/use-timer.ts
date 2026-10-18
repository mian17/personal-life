'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import {
  applyDurations,
  initialState,
  parseMode,
  pause,
  reset,
  serializeMode,
  start,
  tick,
  type Durations,
  type Phase,
  type TimerState,
} from './timer';

/** Four ticks a second keep the digits moving without reading the wall clock. */
const TICK_INTERVAL_MS = 250;

const MODE_STORAGE_KEY = 'pomodoro-mode';

type SetTimerState = Dispatch<SetStateAction<TimerState>>;

export interface Timer {
  phase: Phase;
  session: number;
  remainingMs: number;
  running: boolean;
  startTimer(): void;
  pauseTimer(): void;
  resetTimer(): void;
}

/** Owns the running timer: the pure machine below, plus an interval and the stored mode. */
export function useTimer(durations: Durations): Timer {
  const [state, setState] = useState(() => initialState(durations));

  useRestoredMode(setState, durations);
  useDurationsApplied(setState, durations);
  useTicking(setState, state);
  useModeSaved(state);

  return {
    phase: state.phase,
    session: state.session,
    remainingMs: state.remainingMs,
    running: state.running,
    startTimer: () => setState(start),
    pauseTimer: () => setState(pause),
    resetTimer: () => setState(reset),
  };
}

/** Mount only: restoring after paint keeps the server render deterministic (ThemeToggle's pattern). */
function useRestoredMode(setState: SetTimerState, durations: Durations) {
  useEffect(() => {
    setState(parseMode(readStoredMode(), durations));
  }, []);
}

function useDurationsApplied(setState: SetTimerState, durations: Durations) {
  useEffect(() => {
    setState((current) => applyDurations(current, durations));
  }, [durations]);
}

function useTicking(setState: SetTimerState, state: TimerState) {
  useEffect(() => {
    if (!state.running) return;

    const interval = window.setInterval(() => {
      setState((current) => tick(current, TICK_INTERVAL_MS));
    }, TICK_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [state.running]);
}

// ponytail: mount writes the initial mode, then the restored one in the same effect
// flush, so the settled value is always right. Gate on a "restored" ref if a reload
// ever lands between the two writes.
function useModeSaved(state: TimerState) {
  useEffect(() => {
    window.localStorage.setItem(MODE_STORAGE_KEY, serializeMode(state));
  }, [state.phase, state.session]);
}

function readStoredMode(): string | null {
  return window.localStorage.getItem(MODE_STORAGE_KEY);
}
