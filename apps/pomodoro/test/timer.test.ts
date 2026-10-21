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
  remainingMs,
  reset,
  resume,
  serializeMode,
  start,
  startNext,
  tick,
  type Durations,
  type Phase,
  type TimerState,
} from '../src/timer';

const durations: Durations = { focus: 25, short: 5, long: 15 };

/** Any wall clock the owner happens to start at. */
const START = 1_700_000_000_000;

const FOCUS_MS = durations.focus * MINUTE_MS;
const SHORT_MS = durations.short * MINUTE_MS;

/** The phase reached after each start, beginning with the initial focus session. */
const cycleTable: { phase: Phase; session: number }[] = [
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

function startedTimer(now: number = START): TimerState {
  return start(initialState(durations), now);
}

/** Ends the current phase the way the owner does: the deadline passes, then the button is pressed. */
function pressStartAfterDeadline(state: TimerState): TimerState {
  const atBoundary = tick(state, state.endsAt);
  return startNext(atBoundary, atBoundary.endsAt);
}

function timerAfterStarts(starts: number): TimerState {
  let state = startedTimer();
  for (let press = 0; press < starts; press += 1) state = pressStartAfterDeadline(state);
  return state;
}

function phaseOf(state: TimerState): { phase: Phase; session: number } {
  return { phase: state.phase, session: state.session };
}

describe('remaining time', () => {
  it('reads a phase that has not begun as its whole length, whatever the clock says', () => {
    expect(remainingMs(initialState(durations), START)).toBe(FOCUS_MS);
    expect(remainingMs(initialState(durations), START + 5 * MINUTE_MS)).toBe(FOCUS_MS);
  });

  it('counts down to the deadline a start stamped one phase length ahead', () => {
    const state = startedTimer();
    expect(state.endsAt).toBe(START + FOCUS_MS);

    expect(remainingMs(state, START)).toBe(FOCUS_MS);
    expect(remainingMs(state, START + MINUTE_MS)).toBe(FOCUS_MS - MINUTE_MS);
    expect(remainingMs(state, START + FOCUS_MS)).toBe(0);
  });

  it('clamps to 00:00 once the deadline is reached or passed', () => {
    const state = startedTimer();
    expect(remainingMs(state, START + FOCUS_MS)).toBe(0);
    expect(remainingMs(state, START + FOCUS_MS + 90_000)).toBe(0);
    expect(remainingMs(state, START + 10 * FOCUS_MS)).toBe(0);
  });
});

describe('boundary table', () => {
  it('row: a reached deadline holds the boundary at 00:00 and keeps the finished phase', () => {
    const ended = tick(startedTimer(), START + FOCUS_MS);

    expect(ended.status).toBe('boundary');
    expect(remainingMs(ended, START + FOCUS_MS)).toBe(0);
    expect(phaseOf(ended)).toEqual({ phase: 'focus', session: 1 });
  });

  it('row: a tick arriving long after the deadline still lands on the boundary, losing no extra time', () => {
    const tenPhasesLate = START + 10 * FOCUS_MS;

    const ended = tick(startedTimer(), tenPhasesLate);

    expect(ended.status).toBe('boundary');
    expect(remainingMs(ended, tenPhasesLate)).toBe(0);
    expect(phaseOf(ended)).toEqual({ phase: 'focus', session: 1 });
  });

  it('row: nothing advances without its own start, however often the clock is read', () => {
    let state = tick(startedTimer(), START + FOCUS_MS);
    for (const now of [FOCUS_MS, 2 * FOCUS_MS, 3 * FOCUS_MS]) state = tick(state, START + now);

    expect(state.status).toBe('boundary');
    expect(phaseOf(state)).toEqual({ phase: 'focus', session: 1 });
    expect(remainingMs(state, START + 3 * FOCUS_MS)).toBe(0);
  });

  it('row: a start after the boundary gives the next phase its own full duration from that moment', () => {
    const ended = tick(startedTimer(), START + FOCUS_MS);
    const pressed = startNext(ended, START + FOCUS_MS + 90_000);

    expect(pressed.status).toBe('running');
    expect(phaseOf(pressed)).toEqual({ phase: 'short', session: 1 });
    expect(pressed.endsAt).toBe(START + FOCUS_MS + 90_000 + SHORT_MS);
    expect(remainingMs(pressed, START + FOCUS_MS + 90_000)).toBe(SHORT_MS);
  });

  it('row: a boundary names the phase after the finished one, never skipping it', () => {
    const reached = cycleTable.map((_, starts) => phaseOf(timerAfterStarts(starts)));

    expect(reached).toEqual(cycleTable);
  });

  it('row: a break belongs to the session it follows, so session moves only when focus begins', () => {
    expect(phaseOf(timerAfterStarts(6))).toEqual({ phase: 'focus', session: 4 });
    expect(phaseOf(timerAfterStarts(7))).toEqual({ phase: 'long', session: SESSIONS_PER_CYCLE });
    expect(phaseOf(timerAfterStarts(8))).toEqual({ phase: 'focus', session: 1 });
  });
});

describe('tick', () => {
  it('leaves a running timer on its phase while the deadline is still ahead', () => {
    const state = startedTimer();
    expect(tick(state, START + MINUTE_MS)).toEqual(state);
  });

  it('leaves a boundary and an idle timer untouched', () => {
    const ended = tick(startedTimer(), START + FOCUS_MS);
    expect(tick(ended, START + 2 * FOCUS_MS)).toEqual(ended);
    expect(tick(initialState(durations), START)).toEqual(initialState(durations));
  });
});

describe('pause and resume', () => {
  it('freezes the remaining time the pause instant had', () => {
    const paused = pause(startedTimer(), START + 5 * MINUTE_MS);

    expect(paused.status).toBe('paused');
    expect(paused.endsAt).toBe(startedTimer().endsAt);
    expect(remainingMs(paused, START + 60 * MINUTE_MS)).toBe(FOCUS_MS - 5 * MINUTE_MS);
  });

  it('spends the frozen time from the resume instant', () => {
    const paused = pause(startedTimer(), START + 5 * MINUTE_MS);
    const resumed = resume(paused, START + 60 * MINUTE_MS);

    expect(resumed.status).toBe('running');
    expect(resumed.endsAt).toBe(START + 60 * MINUTE_MS + (FOCUS_MS - 5 * MINUTE_MS));
    expect(remainingMs(resumed, START + 60 * MINUTE_MS)).toBe(FOCUS_MS - 5 * MINUTE_MS);
  });

  it('ignores a pause that is not running and a resume that is not paused', () => {
    const running = startedTimer();

    expect(pause(initialState(durations), START)).toEqual(initialState(durations));
    expect(resume(running, START)).toEqual(running);
  });

  it('survives the stored-mode round trip with the held time', () => {
    const paused = pause(startedTimer(), START + 5 * MINUTE_MS);

    expect(parseMode(serializeMode(paused, START + 9 * MINUTE_MS), { durations, now: START + 9 * MINUTE_MS })).toEqual(paused);
  });

  it('reads a paused blob written before heldMs existed as unreadable, not as zero', () => {
    const legacy =
      '{"phase":"focus","session":1,"status":"paused","remainingMs":600000,"endsAt":0}';

    expect(parseMode(legacy, { durations, now: START })).toEqual(initialState(durations));
  });
});

describe('reset', () => {
  it('starts the whole cycle over from the first focus', () => {
    const ended = tick(startedTimer(), START + FOCUS_MS);

    expect(reset(ended)).toEqual(initialState(durations));
    expect(reset(pause(startedTimer(), START + MINUTE_MS))).toEqual(initialState(durations));
  });

  it('keeps the chosen durations, since they are a preference', () => {
    const chosen: Durations = { focus: 40, short: 8, long: 20 };
    const ended = tick(start(initialState(chosen), START), START + 40 * MINUTE_MS);

    expect(reset(ended)).toEqual(initialState(chosen));
  });
});

describe('applyDurations', () => {
  it('sizes the phase that starts next and leaves a running deadline alone', () => {
    const chosen: Durations = { focus: 40, short: 8, long: 20 };
    const running = startedTimer();

    const updated = applyDurations(running, chosen);
    const afterBoundary = startNext(tick(updated, updated.endsAt), updated.endsAt);

    expect(updated.endsAt).toBe(running.endsAt);
    expect(updated.durations).toEqual(chosen);
    expect(remainingMs(afterBoundary, updated.endsAt)).toBe(chosen.short * MINUTE_MS);
  });

  it('sizes an idle phase from the new durations', () => {
    const chosen: Durations = { focus: 40, short: 8, long: 20 };
    const updated = applyDurations(initialState(durations), chosen);

    expect(remainingMs(updated, START)).toBe(chosen.focus * MINUTE_MS);
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
    expect(remainingMs(state, START)).toBe(DEFAULT_MINUTES * MINUTE_MS);
  });
});

describe('mode codec', () => {
  it('round-trips a running phase with its deadline and remaining time', () => {
    const running = startedTimer();
    const stored = serializeMode(running, START + 2 * MINUTE_MS);

    expect(stored).toBe(
      JSON.stringify({
        phase: 'focus',
        session: 1,
        status: 'running',
        remainingMs: FOCUS_MS - 2 * MINUTE_MS,
        endsAt: START + FOCUS_MS,
        heldMs: 0,
      }),
    );
    expect(parseMode(stored, { durations, now: START + 3 * MINUTE_MS })).toEqual(running);
  });

  it('round-trips a boundary left as it was', () => {
    const ended = tick(startedTimer(), START + FOCUS_MS);

    expect(
      parseMode(serializeMode(ended, START + FOCUS_MS), { durations, now: START + 5 * FOCUS_MS }),
    ).toEqual(ended);
  });

  it('round-trips an idle phase', () => {
    const idle = initialState(durations);

    expect(parseMode(serializeMode(idle, START), { durations, now: START + 5 * MINUTE_MS })).toEqual(idle);
  });

  it('restores a running mode whose deadline passed while the page was gone as its boundary', () => {
    const stored = serializeMode(startedTimer(), START);
    const restored = parseMode(stored, { durations, now: START + 3 * FOCUS_MS });

    expect(restored.status).toBe('boundary');
    expect(phaseOf(restored)).toEqual({ phase: 'focus', session: 1 });
    expect(remainingMs(restored, START + 3 * FOCUS_MS)).toBe(0);
  });

  it('restores a running mode whose deadline has not passed as still running', () => {
    const stored = serializeMode(startedTimer(), START);
    expect(parseMode(stored, { durations, now: START + MINUTE_MS }).status).toBe('running');
  });

  it('restores the idle phase for a malformed or absent blob', () => {
    const invalid = [undefined, null, '', 'not json', '{"phase":"nope"}', '{"phase":"focus","session":9}'];

    for (const raw of invalid) {
      expect(parseMode(raw as string | undefined, { durations, now: START })).toEqual(
        initialState(durations),
      );
    }
  });
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
