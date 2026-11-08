'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { playBoundaryBeep, primeBoundaryAudio } from './beep';
import {
  applyDurations,
  initialState,
  parseMode,
  pause,
  remainingMs,
  reset,
  resume,
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

/**
 * The deadline whose end has already been sounded. The beep belongs to the phase
 * end, not to the mount, so a card that mounts again on the same `00:00` —
 * returning from settings, a reload — stays silent; a deadline that passed while
 * the page was gone was never sounded, and still is.
 */
const ANNOUNCED_DEADLINE_KEY = 'pomodoro-announced';

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
  /** The length the phase in hand was started with, the one base its progress is read against. */
  startedPhaseMs: number;
  titles: TimerTitles;
  /** Start, pause or resume — whichever the current status makes the one useful control. */
  primaryAction(): void;
  /** Back to the first focus of a fresh cycle; the caller confirms it first. */
  resetCycle(): void;
  startRef: RefObject<HTMLButtonElement | null>;
}

/** One control for start, pause and resume, so the card never grows a third button. */
function primaryActionFor(status: Status, setState: SetTimerState): () => void {
  if (status === 'running') return () => setState((current) => pause(current, Date.now()));
  if (status === 'paused') return () => setState((current) => resume(current, Date.now()));
  return () => setState((current) => startNext(current, Date.now()));
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
  useBoundaryAnnouncement(state, startRef);

  return {
    status: state.status,
    phase: state.phase,
    session: state.session,
    nextPhase,
    remainingMs: remainingMs(state, Date.now()),
    startedPhaseMs: state.startedPhaseMs,
    titles,
    // The Start gesture unlocks the beep; a resume inside it needs nothing.
    primaryAction: () => {
      primeBoundaryAudio();
      primaryActionFor(state.status, setState)();
    },
    resetCycle: () => setState((current) => reset(current)),
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

/** Entering the boundary announces once: a beep, the button focus, and a flashing tab title. */
function useBoundaryAnnouncement(
  state: TimerState,
  startRef: RefObject<HTMLButtonElement | null>,
) {
  useEffect(() => {
    if (state.status !== 'boundary') {
      document.title = PINNED_TITLE;
      return;
    }

    startRef.current?.focus();
    beepOnce(state.endsAt);

    return flashTitle(nextPhaseTitle(phaseStartedNext(state)));
  }, [state, startRef]);
}

/**
 * The beep is the phase end, not the mount. The marker outlives the page, so the
 * StrictMode replay and every later mount of the same `00:00` skip it.
 */
function beepOnce(endsAt: number): void {
  if (readAnnouncedDeadline() === endsAt) return;

  writeAnnouncedDeadline(endsAt);
  playBoundaryBeep();
}

function readAnnouncedDeadline(): number | null {
  const stored = Number(window.localStorage.getItem(ANNOUNCED_DEADLINE_KEY));
  return Number.isFinite(stored) ? stored : null;
}

function writeAnnouncedDeadline(endsAt: number): void {
  window.localStorage.setItem(ANNOUNCED_DEADLINE_KEY, String(endsAt));
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
