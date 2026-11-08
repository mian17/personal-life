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
  /**
   * The length the phase in hand was started with, in milliseconds, or the length its
   * durations give while it has not begun. It is the one base a phase's progress may be
   * read against: `durations` is a preference the owner can retune at any moment (the
   * focus chips do), so deriving minutes from it would credit time never focused.
   */
  startedPhaseMs: number;
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

/**
 * Whether `value` is a whole-minute daily goal the service would accept.
 *
 * Today the service bounds a goal by the same `MINUTES_RANGE` rule a recorded block is held
 * to, so the app must not offer a value the service would reject.
 */
export function isDailyGoal(value: unknown): value is number {
  return isWholeMinute(value);
}

export const DEFAULT_MINUTES = DEFAULT_DURATIONS.focus;

export function initialState(durations: Durations): TimerState {
  return {
    phase: 'focus',
    session: 1,
    durations,
    status: 'idle',
    endsAt: 0,
    heldMs: 0,
    startedPhaseMs: phaseDurationMs('focus', durations),
  };
}

export function start(state: TimerState, now: number): TimerState {
  const phaseMs = phaseDurationMs(state.phase, state.durations);
  return {
    ...state,
    status: 'running',
    endsAt: now + phaseMs,
    heldMs: 0,
    startedPhaseMs: phaseMs,
  };
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
  // An idle phase has not begun, so its whole length is the length its durations hold now —
  // nothing was ever started for it, and a chip retuning it moves the digits, and only them.
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

/**
 * New durations size the phase that starts after this one. A phase already in hand keeps the
 * length it was started with — its deadline, its held time and `startedPhaseMs` are left
 * alone — so a length retuned mid-phase neither restretches the countdown nor rewrites what
 * the phase has already spent. An idle phase has not begun, so it takes the new length.
 */
export function applyDurations(state: TimerState, durations: Durations): TimerState {
  if (state.status !== 'idle') return { ...state, durations };
  return { ...state, durations, startedPhaseMs: phaseDurationMs(state.phase, durations) };
}

export function serializeMode(state: TimerState, now: number): string {
  return JSON.stringify({
    phase: state.phase,
    session: state.session,
    status: state.status,
    remainingMs: remainingMs(state, now),
    endsAt: state.endsAt,
    heldMs: state.heldMs,
    startedPhaseMs: state.startedPhaseMs,
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
  /** The length the phase was started with; absent in a blob written before it was carried. */
  startedPhaseMs?: number;
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
    startedPhaseMs: restoredPhaseMs(stored, context.durations),
  };
}

/**
 * The length the restored phase was started with. A phase still in hand carries it; an idle
 * one has not begun, so its durations are its length. A boundary was reported by the page that
 * reached it, so its `00:00` is all this mount may read it as.
 *
 * A blob from before this field existed cannot know its own length, so it falls back to the
 * durations in hand. That is the old reading, correct whenever no chip retuned the phase —
 * which is every blob older than the bug being fixed, because a retune is what made it wrong.
 */
function restoredPhaseMs(stored: StoredMode, durations: Durations): number {
  if (stored.status === 'running' || stored.status === 'paused') {
    return stored.startedPhaseMs ?? phaseDurationMs(stored.phase, durations);
  }
  return phaseDurationMs(stored.phase, durations);
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
  if (!isWholeMinute(value)) return DEFAULT_MINUTES;
  return value;
}

/** The one rule both a recorded block and a daily goal are held to: a whole minute inside `MINUTES_RANGE`. */
function isWholeMinute(value: unknown): value is number {
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
    startedPhaseMs,
  } = parsed as Partial<StoredMode>;
  if (!isPhase(phase) || !isSession(session) || !isStatus(status)) return null;
  if (!isRuntimeNumber(storedRemaining) || !isRuntimeNumber(endsAt)) return null;

  // A blob written before pause existed has no `heldMs`; it is only meaningful
  // for a paused phase, and no old blob can be one, so absence reads as zero.
  const storedHeld = isRuntimeNumber(heldMs) ? heldMs : 0;
  if (status === 'paused' && !isRuntimeNumber(heldMs)) return null;

  return {
    phase,
    session,
    status,
    remainingMs: storedRemaining,
    endsAt,
    heldMs: storedHeld,
    // Absence stays absent, so `restoredPhaseMs` can tell a blob that never carried
    // the length from one that carried a length of zero.
    ...(isRuntimeNumber(startedPhaseMs) ? { startedPhaseMs } : {}),
  };
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
