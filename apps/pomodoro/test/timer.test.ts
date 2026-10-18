import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEFAULT_DURATIONS,
  DEFAULT_MINUTES,
  MINUTE_MS,
  SESSIONS_PER_CYCLE,
  applyDurations,
  clampMinutes,
  initialState,
  parseMode,
  pause,
  reset,
  serializeMode,
  start,
  tick,
  type Durations,
  type TimerState,
} from '../src/timer';

const durations: Durations = { focus: 25, short: 5, long: 15 };

/** The phase reached after each transition, starting with the initial focus session. */
const cycleTable = [
  { phase: 'focus', session: 1 },
  { phase: 'short', session: 1 },
  { phase: 'focus', session: 2 },
  { phase: 'short', session: 2 },
  { phase: 'focus', session: 3 },
  { phase: 'short', session: 3 },
  { phase: 'focus', session: 4 },
  { phase: 'long', session: 4 },
  { phase: 'focus', session: 1 },
];

function startedState(): TimerState {
  return start(initialState(durations));
}

/** Runs the current phase out to zero so the next phase has just begun. */
function finishPhase(state: TimerState): TimerState {
  return tick(state, state.remainingMs);
}

/** Replays phase changes from a fresh running timer. */
function stateAfter(transitions: number): TimerState {
  let state = startedState();
  for (let step = 0; step < transitions; step += 1) state = finishPhase(state);
  return state;
}

function modeOf(state: TimerState): { phase: string; session: number } {
  return { phase: state.phase, session: state.session };
}

describe('phase table', () => {
  it('advances focus 1 → short → focus 2 → short → focus 3 → short → focus 4 → long → focus 1', () => {
    const reached = cycleTable.map((_, transitions) => modeOf(stateAfter(transitions)));
    expect(reached).toEqual(cycleTable);
  });

  it('gives every advanced phase its own full duration and keeps the timer running', () => {
    const atShortBreak = stateAfter(1);
    expect(atShortBreak).toMatchObject({ remainingMs: durations.short * MINUTE_MS, running: true });

    const atSecondFocus = stateAfter(2);
    expect(atSecondFocus).toMatchObject({ remainingMs: durations.focus * MINUTE_MS, running: true });
  });

  it('puts a break in the session it follows, so session only moves when focus begins', () => {
    expect(modeOf(stateAfter(6))).toEqual({ phase: 'focus', session: 4 });
    expect(modeOf(stateAfter(7))).toEqual({ phase: 'long', session: SESSIONS_PER_CYCLE });
  });
});

describe('tick', () => {
  it('decrements the remaining time by the elapsed time while running', () => {
    const state = tick(startedState(), 1000);
    expect(state).toMatchObject({ phase: 'focus', session: 1, remainingMs: durations.focus * MINUTE_MS - 1000 });
  });

  it('advances exactly one phase when the elapsed time overshoots the remaining time', () => {
    const state = tick(startedState(), durations.focus * MINUTE_MS + 30_000);
    expect(state).toMatchObject({
      phase: 'short',
      session: 1,
      remainingMs: durations.short * MINUTE_MS,
      running: true,
    });
  });

  it('leaves a paused timer untouched', () => {
    const paused = pause(startedState());
    expect(tick(paused, 30_000)).toEqual(paused);
  });
});

describe('start and pause', () => {
  it('freezes the remaining time on pause and resumes from it on start', () => {
    const running = tick(startedState(), 60_000);
    const frozen = pause(running);
    const resumed = start(frozen);
    const continued = tick(resumed, 60_000);

    expect(frozen).toMatchObject({ running: false, remainingMs: 24 * MINUTE_MS });
    expect(tick(frozen, 60_000)).toEqual(frozen);
    expect(resumed).toMatchObject({ running: true, remainingMs: 24 * MINUTE_MS });
    expect(continued.remainingMs).toBe(23 * MINUTE_MS);
  });
});

describe('reset', () => {
  it('returns session 1, focus and the full focus duration from any later phase', () => {
    const midLongBreak = pause(stateAfter(7));

    expect(reset(midLongBreak)).toEqual(initialState(durations));
    expect(reset(midLongBreak)).toMatchObject({
      phase: 'focus',
      session: 1,
      remainingMs: durations.focus * MINUTE_MS,
    });
  });

  it('keeps the chosen durations when resetting', () => {
    const chosen: Durations = { focus: 50, short: 10, long: 20 };
    const resetState = reset(initialState(chosen));

    expect(resetState.durations).toEqual(chosen);
    expect(resetState.remainingMs).toBe(chosen.focus * MINUTE_MS);
  });
});

describe('applyDurations', () => {
  it('restarts the current phase at the new length while paused', () => {
    const paused = pause(tick(startedState(), 5 * MINUTE_MS));
    const chosen: Durations = { focus: 40, short: 8, long: 20 };

    const updated = applyDurations(paused, chosen);

    expect(updated).toMatchObject({
      durations: chosen,
      remainingMs: chosen.focus * MINUTE_MS,
      running: false,
    });
  });
});

describe('clampMinutes', () => {
  it('accepts every integer minute from 1 to 180', () => {
    expect(clampMinutes(1)).toBe(1);
    expect(clampMinutes(25)).toBe(25);
    expect(clampMinutes(180)).toBe(180);
  });

  it.each([[0], [-5], [2.5], [Number.NaN], [Number.POSITIVE_INFINITY], ['25'], ['not a number'], [null]])(
    'falls back to the module default for %p',
    (value) => {
      expect(clampMinutes(value)).toBe(DEFAULT_MINUTES);
    },
  );

  it('clamps a malformed duration inside the state machine too', () => {
    const state = initialState({ focus: 0, short: 2.5, long: -1 });
    expect(state.remainingMs).toBe(DEFAULT_MINUTES * MINUTE_MS);

    const advanced = finishPhase(start(state));
    expect(advanced.remainingMs).toBe(DEFAULT_MINUTES * MINUTE_MS);
  });
});

describe('mode codec', () => {
  it('round-trips phase and session', () => {
    const midCycle = stateAfter(3);
    const restored = parseMode(serializeMode(midCycle), durations);

    expect(serializeMode(midCycle)).toBe('{"phase":"short","session":2}');
    expect(restored).toMatchObject({ phase: 'short', session: 2, running: false });
  });

  it('restarts the restored phase at its full duration', () => {
    const restored = parseMode(serializeMode(stateAfter(1)), durations);
    expect(restored.remainingMs).toBe(durations.short * MINUTE_MS);
  });

  it.each([[undefined], [null], [''], ['not json'], ['{"phase":"nope"}'], ['{"phase":"focus","session":9}']])(
    'falls back to the initial state for %p',
    (raw) => {
      expect(parseMode(raw as string | undefined, durations)).toEqual(initialState(durations));
    },
  );
});

describe('purity', () => {
  it('mentions no react, next/ or localStorage', () => {
    const source = readFileSync(join(__dirname, '../src/timer.ts'), 'utf8');
    expect(source).not.toMatch(/react|next\/|localStorage/);
  });

  it('ships the default durations 25 / 5 / 15', () => {
    expect(DEFAULT_DURATIONS).toEqual({ focus: 25, short: 5, long: 15 });
  });
});
