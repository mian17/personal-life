export type Phase = 'focus' | 'short' | 'long';

/**
 * `idle` has not begun, `running` counts to its deadline, `paused` holds that
 * remaining time until the owner resumes, `boundary` holds 00:00 until a start.
 */
export type Status = 'idle' | 'running' | 'paused' | 'boundary';

/** Length of each phase, in integer minutes. */
export interface Durations {
  focus: number;
  short: number;
  long: number;
}

export interface TimerState {
  phase: Phase;
  session: number;
  /** Durations ride in state so starting a phase needs nothing but the wall clock. */
  durations: Durations;
  status: Status;
  /** The phase's deadline, in epoch milliseconds; unused before the first start. */
  endsAt: number;
  /** The time left when the owner paused, in milliseconds; only a paused phase reads it. */
  heldMs: number;
}

/** What the machine needs from outside its state: the chosen lengths and the wall clock. */
export interface TimerContext {
  durations: Durations;
  now: number;
}

export const SESSIONS_PER_CYCLE = 4;

export const DEFAULT_DURATIONS: Durations = { focus: 25, short: 5, long: 15 };

export const MINUTE_MS = 60_000;

export const MINUTES_RANGE = { min: 1, max: 180 } as const;

export const DEFAULT_MINUTES = DEFAULT_DURATIONS.focus;

export function initialState(durations: Durations): TimerState {
  return { phase: 'focus', session: 1, durations, status: 'idle', endsAt: 0, heldMs: 0 };
}

export function start(state: TimerState, now: number): TimerState {
  const phaseMs = phaseDurationMs(state.phase, state.durations);
  return { ...state, status: 'running', endsAt: now + phaseMs, heldMs: 0 };
}

/** Freezing the remaining time is what stops the count; the deadline stops mattering. */
export function pause(state: TimerState, now: number): TimerState {
  if (state.status !== 'running') return state;
  return { ...state, status: 'paused', heldMs: remainingMs(state, now) };
}

/** Resuming spends the frozen time from this instant, so a long pause costs the phase nothing. */
export function resume(state: TimerState, now: number): TimerState {
  if (state.status !== 'paused') return state;
  return { ...state, status: 'running', endsAt: now + state.heldMs, heldMs: 0 };
}

/** The whole cycle again, from the first focus: sessions, phase and count all go back. */
export function reset(state: TimerState): TimerState {
  return initialState(state.durations);
}

/** No phase begins on its own, so this is the only path past a boundary. */
export function startNext(state: TimerState, now: number): TimerState {
  return start(phaseAfterBoundary(state), now);
}

export function remainingMs(state: TimerState, now: number): number {
  if (state.status === 'idle') return phaseDurationMs(state.phase, state.durations);
  if (state.status === 'paused') return state.heldMs;
  return Math.max(0, state.endsAt - now);
}

/** A deadline reached — whenever the tick notices — holds the boundary; a late tick owes the phase nothing. */
export function tick(state: TimerState, now: number): TimerState {
  if (state.status !== 'running') return state;
  if (now < state.endsAt) return state;
  return { ...state, status: 'boundary' };
}

/** New durations size the phase that starts after this one; a running deadline stays as it is. */
export function applyDurations(state: TimerState, durations: Durations): TimerState {
  return { ...state, durations };
}

export function serializeMode(state: TimerState, now: number): string {
  return JSON.stringify({
    phase: state.phase,
    session: state.session,
    status: state.status,
    remainingMs: remainingMs(state, now),
    endsAt: state.endsAt,
    heldMs: state.heldMs,
  } satisfies StoredMode);
}

export function parseMode(raw: string | null | undefined, context: TimerContext): TimerState {
  const stored = readMode(raw);
  if (!stored) return initialState(context.durations);
  return restoreMode(stored, context);
}

interface TimerMode {
  phase: Phase;
  session: number;
}

interface StoredMode extends TimerMode {
  status: Status;
  remainingMs: number;
  endsAt: number;
  heldMs: number;
}

/** A boundary belongs to the phase it ended, so advancing starts from the phase after it. */
function phaseAfterBoundary(state: TimerState): TimerState {
  if (state.status !== 'boundary') return state;

  const next = nextStep(state.phase, state.session);
  return { ...state, phase: next.phase, session: next.session, status: 'idle', endsAt: 0 };
}

function restoreMode(stored: StoredMode, context: TimerContext): TimerState {
  const status = restoredStatus(stored, context.now);
  return {
    phase: stored.phase,
    session: stored.session,
    durations: context.durations,
    status,
    endsAt: status === 'idle' ? 0 : stored.endsAt,
    heldMs: status === 'paused' ? stored.heldMs : 0,
  };
}

/** A `running` deadline that passed while the page was gone belongs to the boundary. */
function restoredStatus(stored: StoredMode, now: number): Status {
  if (stored.status !== 'running') return stored.status;
  return stored.endsAt > now ? 'running' : 'boundary';
}

/** A break belongs to the session it follows, so session only moves when focus begins. */
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

function readMode(raw: string | null | undefined): StoredMode | null {
  if (!raw) return null;

  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== 'object') return null;

  const {
    phase,
    session,
    status,
    remainingMs: storedRemaining,
    endsAt,
    heldMs,
  } = parsed as Partial<StoredMode>;
  if (!isPhase(phase) || !isSession(session) || !isStatus(status)) return null;
  if (!isRuntimeNumber(storedRemaining) || !isRuntimeNumber(endsAt)) return null;

  // A blob written before pause existed has no `heldMs`; it is only meaningful
  // for a paused phase, and no old blob can be one, so absence reads as zero.
  const storedHeld = isRuntimeNumber(heldMs) ? heldMs : 0;
  if (status === 'paused' && !isRuntimeNumber(heldMs)) return null;

  return { phase, session, status, remainingMs: storedRemaining, endsAt, heldMs: storedHeld };
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

function isStatus(value: unknown): value is Status {
  return value === 'idle' || value === 'running' || value === 'paused' || value === 'boundary';
}

function isSession(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= SESSIONS_PER_CYCLE
  );
}

function isRuntimeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
