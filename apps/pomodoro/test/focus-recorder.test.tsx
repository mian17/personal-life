import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { focusBlockMinutes } from '../src/focus-recorder';
import { PomodoroPage } from '../src/pomodoro-page';
import { DEFAULT_DURATIONS, MINUTE_MS, type Durations } from '../src/timer';

/**
 * Every case here reads the seam an owner's day is recorded through: the pure
 * minute arithmetic, and the one call the page makes per focus block that ended
 * — at its boundary or at a reset mid-focus, never for a break, never twice.
 */

const MODE_STORAGE_KEY = 'pomodoro-mode';

const ONE_MINUTE_FOCUS: Durations = { focus: 1, short: 1, long: 1 };

const FIVE_MINUTE_FOCUS: Durations = { focus: 5, short: 1, long: 1 };

interface StoredMode {
  phase: string;
  session: number;
  status: string;
  remainingMs: number;
  endsAt: number;
}

function storeMode(mode: StoredMode): void {
  window.localStorage.setItem(
    MODE_STORAGE_KEY,
    JSON.stringify({ ...mode, heldMs: mode.remainingMs }),
  );
}

/** Run the clock forward inside `act`, so the hook's effects land before the assertion. */
function wait(milliseconds: number): void {
  act(() => {
    jest.advanceTimersByTime(milliseconds);
  });
}

function startFocus(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Start focus' }));
}

function clickReset(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
}

describe('focusBlockMinutes', () => {
  it('counts the whole minutes a focus phase has run', () => {
    const focusRemaining = DEFAULT_DURATIONS.focus * MINUTE_MS - 95_000;

    expect(
      focusBlockMinutes({
        phase: 'focus',
        startedPhaseMs: DEFAULT_DURATIONS.focus * MINUTE_MS,
        remainingMs: focusRemaining,
      }),
    ).toBe(1);
  });

  it('discards a part-minute block', () => {
    const focusRemaining = DEFAULT_DURATIONS.focus * MINUTE_MS - 40_000;

    expect(
      focusBlockMinutes({
        phase: 'focus',
        startedPhaseMs: DEFAULT_DURATIONS.focus * MINUTE_MS,
        remainingMs: focusRemaining,
      }),
    ).toBe(0);
  });

  it('never counts a break, however long it has run', () => {
    const startedPhaseMs = DEFAULT_DURATIONS.focus * MINUTE_MS;

    expect(focusBlockMinutes({ phase: 'short', startedPhaseMs, remainingMs: 0 })).toBe(0);
    expect(focusBlockMinutes({ phase: 'long', startedPhaseMs, remainingMs: 0 })).toBe(0);
  });
});

describe('useFocusRecorded through the page', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
    stubAudioContext();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  it('reports a completed focus block once, when the phase reaches its boundary', () => {
    const onFocusBlockEnd = jest.fn();
    render(<PomodoroPage durations={ONE_MINUTE_FOCUS} onFocusBlockEnd={onFocusBlockEnd} />);

    startFocus();
    wait(ONE_MINUTE_FOCUS.focus * MINUTE_MS + 1_000);

    expect(screen.getByRole('button', { name: 'Start break' })).toBeTruthy();
    expect(onFocusBlockEnd).toHaveBeenCalledTimes(1);
    expect(onFocusBlockEnd).toHaveBeenCalledWith(1);
  });

  it('reports nothing for a break that runs out', () => {
    const onFocusBlockEnd = jest.fn();
    render(<PomodoroPage durations={ONE_MINUTE_FOCUS} onFocusBlockEnd={onFocusBlockEnd} />);

    startFocus();
    wait(ONE_MINUTE_FOCUS.focus * MINUTE_MS + 1_000);
    fireEvent.click(screen.getByRole('button', { name: 'Start break' }));
    wait(ONE_MINUTE_FOCUS.short * MINUTE_MS + 1_000);

    expect(onFocusBlockEnd).toHaveBeenCalledTimes(1);
  });

  it('reports an early stop once, from the time the focus phase had counted', () => {
    const onFocusBlockEnd = jest.fn();
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      render(<PomodoroPage durations={FIVE_MINUTE_FOCUS} onFocusBlockEnd={onFocusBlockEnd} />);

      startFocus();
      wait(70_000);
      // Pause is the owner's stop: a counting phase offers no reset, and an
      // abandoned block is still time the day did not lose.
      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
      clickReset();

      expect(onFocusBlockEnd).toHaveBeenCalledTimes(1);
      expect(onFocusBlockEnd).toHaveBeenCalledWith(1);
    } finally {
      confirm.mockRestore();
    }
  });

  it('reports nothing when the abandoned block never reached a minute', () => {
    const onFocusBlockEnd = jest.fn();
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      render(<PomodoroPage durations={FIVE_MINUTE_FOCUS} onFocusBlockEnd={onFocusBlockEnd} />);

      startFocus();
      wait(40_000);
      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
      clickReset();

      expect(onFocusBlockEnd).not.toHaveBeenCalled();
    } finally {
      confirm.mockRestore();
    }
  });

  it('leaves the paused time out of the block it reports', () => {
    const onFocusBlockEnd = jest.fn();
    render(<PomodoroPage durations={ONE_MINUTE_FOCUS} onFocusBlockEnd={onFocusBlockEnd} />);

    startFocus();
    wait(20_000);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    wait(ONE_MINUTE_FOCUS.focus * MINUTE_MS);
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    wait(ONE_MINUTE_FOCUS.focus * MINUTE_MS);

    // A pause that lasted as long as the phase would double the count if it were.
    expect(onFocusBlockEnd).toHaveBeenCalledWith(1);
  });

  it('stays quiet when a page reloads on a boundary it already reported', () => {
    const onFocusBlockEnd = jest.fn();
    storeMode({ phase: 'focus', session: 1, status: 'boundary', remainingMs: 0, endsAt: 1_000 });

    render(<PomodoroPage durations={DEFAULT_DURATIONS} onFocusBlockEnd={onFocusBlockEnd} />);

    expect(screen.getByRole('button', { name: 'Start break' })).toBeTruthy();
    expect(onFocusBlockEnd).not.toHaveBeenCalled();
  });

  it('leaves a break the owner reset out of the day', () => {
    const onFocusBlockEnd = jest.fn();
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      render(<PomodoroPage durations={ONE_MINUTE_FOCUS} onFocusBlockEnd={onFocusBlockEnd} />);

      startFocus();
      wait(ONE_MINUTE_FOCUS.focus * MINUTE_MS + 1_000);
      fireEvent.click(screen.getByRole('button', { name: 'Start break' }));
      wait(ONE_MINUTE_FOCUS.short * MINUTE_MS + 1_000);
      fireEvent.click(screen.getByRole('button', { name: 'Start focus' }));
      wait(40_000);
      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
      clickReset();

      expect(onFocusBlockEnd).toHaveBeenCalledTimes(1);
    } finally {
      confirm.mockRestore();
    }
  });

  it('records the time a phase ran, not the length a chip put in its place', () => {
    // The reported defect: run three minutes of a 25 minute focus, retune the length to 50,
    // then stop and reset. Reading the block against two lengths turns three real minutes
    // into twenty-eight the owner never focused.
    const onFocusBlockEnd = jest.fn();
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      render(
        <PomodoroPage
          durations={DEFAULT_DURATIONS}
          onFocusLengthChange={jest.fn()}
          onFocusBlockEnd={onFocusBlockEnd}
        />,
      );

      startFocus();
      wait(3 * MINUTE_MS);
      fireEvent.click(screen.getByRole('button', { name: '50 min' }));
      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
      clickReset();

      expect(onFocusBlockEnd).toHaveBeenCalledTimes(1);
      expect(onFocusBlockEnd).toHaveBeenCalledWith(3);
    } finally {
      confirm.mockRestore();
    }
  });

  it('records a block that ran its own length however often a chip retuned the next one', () => {
    const onFocusBlockEnd = jest.fn();

    render(
      <PomodoroPage
        durations={DEFAULT_DURATIONS}
        onFocusLengthChange={jest.fn()}
        onFocusBlockEnd={onFocusBlockEnd}
      />,
    );

    startFocus();
    wait(2 * MINUTE_MS);
    fireEvent.click(screen.getByRole('button', { name: '15 min' }));
    wait(DEFAULT_DURATIONS.focus * MINUTE_MS);

    expect(onFocusBlockEnd).toHaveBeenCalledTimes(1);
    expect(onFocusBlockEnd).toHaveBeenCalledWith(DEFAULT_DURATIONS.focus);
  });

  it('records nothing for a run of chip taps, because a length is not progress', () => {
    const onFocusBlockEnd = jest.fn();

    render(
      <PomodoroPage
        durations={DEFAULT_DURATIONS}
        onFocusLengthChange={jest.fn()}
        onFocusBlockEnd={onFocusBlockEnd}
      />,
    );

    for (const label of ['50 min', '15 min', '50 min', '25 min']) {
      fireEvent.click(screen.getByRole('button', { name: label }));
    }

    expect(onFocusBlockEnd).not.toHaveBeenCalled();
  });

  it('records nothing for chip taps made while a phase counts down or holds', () => {
    const onFocusBlockEnd = jest.fn();

    render(
      <PomodoroPage
        durations={DEFAULT_DURATIONS}
        onFocusLengthChange={jest.fn()}
        onFocusBlockEnd={onFocusBlockEnd}
      />,
    );

    startFocus();
    wait(2 * MINUTE_MS);
    fireEvent.click(screen.getByRole('button', { name: '50 min' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: '15 min' }));

    expect(onFocusBlockEnd).not.toHaveBeenCalled();
  });

  it('records nothing without a listener, so the page still mounts alone', () => {
    render(<PomodoroPage durations={ONE_MINUTE_FOCUS} />);

    startFocus();
    wait(ONE_MINUTE_FOCUS.focus * MINUTE_MS + 1_000);

    expect(screen.getByRole('button', { name: 'Start break' })).toBeTruthy();
  });
});

/** The boundary announces itself with a beep; jsdom ships no WebAudio of its own. */
function stubAudioContext(): void {
  class SilentAudioContext implements Partial<AudioContext> {
    currentTime = 0;
    destination = {} as AudioDestinationNode;
    resume(): Promise<void> {
      return Promise.resolve();
    }
    close(): Promise<void> {
      return Promise.resolve();
    }
    createOscillator(): OscillatorNode {
      return {
        frequency: { value: 0 },
        connect: () => undefined,
        start: () => undefined,
        stop: () => undefined,
        onended: null,
      } as unknown as OscillatorNode;
    }
  }

  globalThis.AudioContext = SilentAudioContext as unknown as typeof AudioContext;
}
