'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { playBoundaryBeep, primeBoundaryAudio } from './beep';
import {
  applyDurations,
  initialState,
  parseMode,
  remainingMs,
  serializeMode,
  startNext,
  tick,
  type Durations,
  type Phase,
  type Status,
  type TimerState,
} from './timer';

/** Four ticks a second keep the digits moving; the interval never adds up elapsed time. */
const TICK_INTERVAL_MS = 250;

const TITLE_FLASH_INTERVAL_MS = 1000;

const MODE_STORAGE_KEY = 'pomodoro-mode';

const PINNED_TITLE = 'Pomodoro';

const PHASE_NAMES: Record<Phase, string> = {
  focus: 'Focus',
  short: 'Short break',
  long: 'Long break',
};

type SetTimerState = Dispatch<SetStateAction<TimerState>>;

export interface TimerTitles {
  /** The tab reads this whenever no phase is waiting to be started. */
  pinned: string;
  /** The line the tab alternates with while a phase sits at its boundary. */
  next: string;
}

export interface Timer {
  status: Status;
  phase: Phase;
  session: number;
  nextPhase: Phase;
  remainingMs: number;
  titles: TimerTitles;
  startNext(): void;
  startRef: RefObject<HTMLButtonElement | null>;
}

/** Owns the running timer: the pure machine below, plus the wall clock, the stored mode, its boundary effects. */
export function useTimer(durations: Durations): Timer {
  const [state, setState] = useState(() => initialState(durations));
  const startRef = useRef<HTMLButtonElement>(null);
  const nextPhase = phaseStartedNext(state);
  const titles = { pinned: PINNED_TITLE, next: nextPhaseTitle(nextPhase) };

  useRestoredMode(setState, durations);
  useDurationsApplied(setState, durations);
  useTicking(setState, state.status);
  useModeSaved(state);
  useInitialFocus(startRef);
  useBoundaryAnnouncement(state, startRef);

  return {
    status: state.status,
    phase: state.phase,
    session: state.session,
    nextPhase,
    remainingMs: remainingMs(state, Date.now()),
    titles,
    startNext: () => {
      primeBoundaryAudio();
      setState((current) => startNext(current, Date.now()));
    },
    startRef,
  };
}

/** The cycle table lives in the machine: run the deadline it holds down to a boundary, then ask what a start would begin. */
function phaseStartedNext(state: TimerState): Phase {
  return startNext(tick(state, state.endsAt), Date.now()).phase;
}

function nextPhaseTitle(phase: Phase): string {
  return `Next: ${PHASE_NAMES[phase]}`;
}

/**
 * Mount only: restoring after paint keeps the server render deterministic (ThemeToggle's pattern).
 *
 * The blob is read once, because StrictMode replays this effect and the replay runs after
 * `useModeSaved` has already written the pre-restore mode back — a second read would restore that.
 * The pre-restore write is harmless for the same reason: it and the read share one commit.
 */
function useRestoredMode(setState: SetTimerState, durations: Durations) {
  const storedMode = useRef<string | null>(null);
  const hasReadStoredMode = useRef(false);

  useEffect(() => {
    if (!hasReadStoredMode.current) {
      hasReadStoredMode.current = true;
      storedMode.current = readStoredMode();
    }
    setState(parseMode(storedMode.current, { durations, now: Date.now() }));
  }, []);
}

function useDurationsApplied(setState: SetTimerState, durations: Durations) {
  useEffect(() => {
    setState((current) => applyDurations(current, durations));
  }, [durations]);
}

/** Digits follow the wall clock on render, so the interval owes them nothing but a render. */
function useTicking(setState: SetTimerState, status: Status) {
  const [, reRender] = useReducer((renders: number) => renders + 1, 0);

  useEffect(() => {
    if (status !== 'running') return;

    const interval = window.setInterval(() => {
      setState((current) => tick(current, Date.now()));
      reRender();
    }, TICK_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [status, setState, reRender]);
}

/** Every mode the machine settles on is written back, so a reload resumes from the last render. */
function useModeSaved(state: TimerState) {
  useEffect(() => {
    window.localStorage.setItem(MODE_STORAGE_KEY, serializeMode(state, Date.now()));
  }, [state]);
}

/**
 * First paint lands on the only control, so the owner starts without tabbing.
 * A restored `running` phase renders no button, and the ref answers null.
 */
function useInitialFocus(startRef: RefObject<HTMLButtonElement | null>) {
  useEffect(() => {
    startRef.current?.focus();
  }, [startRef]);
}

/** Entering the boundary is announced once: a beep, the button focus, and a flashing tab title. */
function useBoundaryAnnouncement(
  state: TimerState,
  startRef: RefObject<HTMLButtonElement | null>,
) {
  const announcedDeadline = useRef<number | null>(null);

  useEffect(() => {
    if (state.status !== 'boundary') {
      document.title = PINNED_TITLE;
      return;
    }

    // One deadline, one announcement: StrictMode replays this effect on mount, and a boundary
    // the page was reloaded onto must not sound again when the replay reaches it.
    if (announcedDeadline.current !== state.endsAt) {
      announcedDeadline.current = state.endsAt;
      playBoundaryBeep();
      startRef.current?.focus();
    }

    return flashTitle(nextPhaseTitle(phaseStartedNext(state)));
  }, [state, startRef]);
}

/** Alternates the tab between its pinned name and the next phase, until the returned cleanup stops it. */
function flashTitle(nextTitle: string): () => void {
  let showsNext = false;

  const interval = window.setInterval(() => {
    showsNext = !showsNext;
    document.title = showsNext ? nextTitle : PINNED_TITLE;
  }, TITLE_FLASH_INTERVAL_MS);

  return () => {
    window.clearInterval(interval);
    document.title = PINNED_TITLE;
  };
}

function readStoredMode(): string | null {
  return window.localStorage.getItem(MODE_STORAGE_KEY);
}
