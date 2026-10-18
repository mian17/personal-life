export type Phase = 'focus' | 'short' | 'long';

/** Length of each phase, in integer minutes. */
export interface Durations {
  focus: number;
  short: number;
  long: number;
}

export interface TimerState {
  phase: Phase;
  session: number;
  /** Durations ride in state so ticking needs nothing but elapsed time. */
  durations: Durations;
  remainingMs: number;
  running: boolean;
}

export const SESSIONS_PER_CYCLE = 4;

export const DEFAULT_DURATIONS: Durations = { focus: 25, short: 5, long: 15 };

export const MINUTE_MS = 60_000;

export const MINUTES_RANGE = { min: 1, max: 180 } as const;

export const DEFAULT_MINUTES = DEFAULT_DURATIONS.focus;

export function initialState(durations: Durations): TimerState {
  return {
    phase: 'focus',
    session: 1,
    durations,
    remainingMs: phaseDurationMs('focus', durations),
    running: false,
  };
}

export function start(state: TimerState): TimerState {
  return { ...state, running: true };
}

export function pause(state: TimerState): TimerState {
  return { ...state, running: false };
}

export function reset(state: TimerState): TimerState {
  return initialState(state.durations);
}

export function tick(state: TimerState, elapsedMs: number): TimerState {
  if (!state.running) return state;

  const remainingMs = state.remainingMs - elapsedMs;
  if (remainingMs > 0) return { ...state, remainingMs };

  return { ...advancePhase(state), running: true };
}

export function applyDurations(state: TimerState, durations: Durations): TimerState {
  return {
    ...state,
    durations,
    remainingMs: phaseDurationMs(state.phase, durations),
  };
}

export function serializeMode(state: TimerState): string {
  return JSON.stringify({ phase: state.phase, session: state.session });
}

export function parseMode(raw: string | null | undefined, durations: Durations): TimerState {
  const mode = readMode(raw);
  if (!mode) return initialState(durations);

  return {
    phase: mode.phase,
    session: mode.session,
    durations,
    remainingMs: phaseDurationMs(mode.phase, durations),
    running: false,
  };
}

interface TimerMode {
  phase: Phase;
  session: number;
}

/** A break belongs to the session it follows, so session only moves when focus begins. */
function advancePhase(state: TimerState): TimerState {
  const next = nextStep(state.phase, state.session);
  return {
    ...state,
    phase: next.phase,
    session: next.session,
    remainingMs: phaseDurationMs(next.phase, state.durations),
  };
}

function nextStep(phase: Phase, session: number): TimerMode {
  if (phase === 'focus') {
    return session < SESSIONS_PER_CYCLE
      ? { phase: 'short', session }
      : { phase: 'long', session };
  }
  if (phase === 'short') return { phase: 'focus', session: session + 1 };
  return { phase: 'focus', session: 1 };
}

function phaseDurationMs(phase: Phase, durations: Durations): number {
  return clampMinutes(durations[phase]) * MINUTE_MS;
}

/** Out-of-range input is a mistyped preference, not a shorter phase, so it falls back. */
export function clampMinutes(value: unknown): number {
  if (!isMinutesInRange(value)) return DEFAULT_MINUTES;
  return value;
}

function isMinutesInRange(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MINUTES_RANGE.min &&
    value <= MINUTES_RANGE.max
  );
}

function readMode(raw: string | null | undefined): TimerMode | null {
  if (!raw) return null;

  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== 'object') return null;

  const { phase, session } = parsed as Partial<TimerMode>;
  if (!isPhase(phase) || !isSession(session)) return null;

  return { phase, session };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isPhase(value: unknown): value is Phase {
  return value === 'focus' || value === 'short' || value === 'long';
}

function isSession(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= SESSIONS_PER_CYCLE
  );
}
