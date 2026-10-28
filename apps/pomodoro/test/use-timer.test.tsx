import { StrictMode, type ReactElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Button } from '@life/ui';
import { DEFAULT_DURATIONS, MINUTE_MS } from '../src/timer';
import { useTimer, type Timer } from '../src/use-timer';

/**
 * The hook under the runtime the owner actually runs (`next dev` renders every
 * page inside `StrictMode`), so the doubled mount is the default here, not an
 * extra. Every case below failed before the hook kept its stored mode and its
 * boundary announcement across that second mount.
 */

const MODE_STORAGE_KEY = 'pomodoro-mode';

const durations = DEFAULT_DURATIONS;
const FOCUS_MS = durations.focus * MINUTE_MS;

interface StoredMode {
  phase: string;
  session: number;
  status: string;
  remainingMs: number;
  endsAt: number;
}

let hook: Timer;
let oscillatorsStarted: number;

function Probe(): null {
  hook = useTimer(durations);
  return null;
}

/** The page keeps the control mounted in a hidden row while running; this probe keeps
 *  the unmounted shape so the hook's ref is still proven to tolerate null. */
function StartButtonProbe(): ReactElement | null {
  hook = useTimer(durations);
  if (hook.status === 'running') return null;
  return (
    <Button ref={hook.startRef} onClick={hook.primaryAction}>
      Start
    </Button>
  );
}

function mountUnderStrictMode(): void {
  render(
    <StrictMode>
      <Probe />
    </StrictMode>,
  );
}

function storeMode(mode: StoredMode): void {
  window.localStorage.setItem(MODE_STORAGE_KEY, JSON.stringify(mode));
}

function storedMode(): StoredMode {
  return JSON.parse(window.localStorage.getItem(MODE_STORAGE_KEY) ?? '{}') as StoredMode;
}

function runningMode(endsAt: number): StoredMode {
  return { phase: 'focus', session: 1, status: 'running', remainingMs: FOCUS_MS, endsAt };
}

beforeEach(() => {
  window.localStorage.clear();
  oscillatorsStarted = 0;
  stubAudioContext();
});

describe('useTimer restore', () => {
  it('resumes a stored running phase with its remaining time intact', () => {
    storeMode(runningMode(Date.now() + 600_000));

    mountUnderStrictMode();

    expect(hook.status).toBe('running');
    expect(hook.remainingMs).toBeGreaterThan(590_000);
    expect(hook.remainingMs).toBeLessThanOrEqual(600_000);
    expect(storedMode().status).toBe('running');
  });

  it('lands on the boundary when the stored deadline passed while the page was gone', () => {
    storeMode(runningMode(Date.now() - 1_000));

    mountUnderStrictMode();

    expect(hook.status).toBe('boundary');
    expect(hook.remainingMs).toBe(0);
    expect(hook.nextPhase).toBe('short');
  });

  it('restores a stored boundary as it was left', () => {
    storeMode(runningMode(Date.now() + 600_000));
    storeMode({
      phase: 'focus',
      session: 2,
      status: 'boundary',
      remainingMs: 0,
      endsAt: Date.now() - 5_000,
    });

    mountUnderStrictMode();

    expect(hook.status).toBe('boundary');
    expect(hook.phase).toBe('focus');
    expect(hook.session).toBe(2);
    expect(hook.nextPhase).toBe('short');
  });

  it('restores a stored idle break at its full length', () => {
    storeMode({
      phase: 'short',
      session: 3,
      status: 'idle',
      remainingMs: durations.short * MINUTE_MS,
      endsAt: 0,
    });

    mountUnderStrictMode();

    expect(hook.status).toBe('idle');
    expect(hook.phase).toBe('short');
    expect(hook.session).toBe(3);
    expect(hook.remainingMs).toBe(durations.short * MINUTE_MS);
  });
});

describe('useTimer initial focus', () => {
  it('leaves focus on the body when the card mounts', () => {
    render(
      <StrictMode>
        <StartButtonProbe />
      </StrictMode>,
    );

    expect(hook.status).toBe('idle');
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Start' }));
  });

  it('leaves focus alone when a restored running phase renders no start button', () => {
    storeMode(runningMode(Date.now() + 600_000));

    render(
      <StrictMode>
        <StartButtonProbe />
      </StrictMode>,
    );

    expect(hook.status).toBe('running');
    expect(document.activeElement).toBe(document.body);
  });
});

describe('useTimer boundary announcement', () => {
  it('sounds one beep for the boundary a reload landed on', () => {
    storeMode(runningMode(Date.now() - 1_000));

    mountUnderStrictMode();

    expect(hook.status).toBe('boundary');
    expect(oscillatorsStarted).toBe(1);
  });

  it('moves focus to the start button when the boundary arrives', () => {
    storeMode(runningMode(Date.now() - 1_000));

    render(
      <StrictMode>
        <StartButtonProbe />
      </StrictMode>,
    );

    expect(hook.status).toBe('boundary');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Start' }));
  });

  it('stays silent when the card mounts again on the boundary it already sounded', () => {
    // The owner leaves for the settings page and comes back: the same dead
    // phase, the same stored `endsAt`, a fresh mount. It was already announced,
    // so the second card must not beep again.
    storeMode(runningMode(Date.now() - 1_000));
    mountUnderStrictMode();
    expect(hook.status).toBe('boundary');
    expect(oscillatorsStarted).toBe(1);

    cleanup();
    mountUnderStrictMode();

    expect(hook.status).toBe('boundary');
    expect(oscillatorsStarted).toBe(1);
  });

  it('sounds one beep for a boundary the running phase reached', () => {
    jest.useFakeTimers();
    try {
      mountUnderStrictMode();
      act(() => hook.primaryAction());
      act(() => {
        jest.advanceTimersByTime(FOCUS_MS + 1_000);
      });

      expect(hook.status).toBe('boundary');
      expect(oscillatorsStarted).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

/** Counts the oscillators a beep starts; jsdom ships no WebAudio of its own. */
function stubAudioContext(): void {
  class CountingAudioContext implements Partial<AudioContext> {
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
        start: () => {
          oscillatorsStarted += 1;
        },
        stop: () => undefined,
        onended: null,
      } as unknown as OscillatorNode;
    }
  }

  globalThis.AudioContext = CountingAudioContext as unknown as typeof AudioContext;
}
