/**
 * @jest-environment jsdom
 *
 * The adapter is the only thing under test: `PomodoroPage` stays an element in the tree, so
 * this suite drives `TimerRecorder` as a plain function the way `todo-item.test.tsx` and
 * `push-toggle.test.tsx` do. That keeps the assertion on the one thing that changed — how many
 * times a chip pick reaches the server, and with which value.
 */
import type { ReactElement } from 'react';

jest.mock('../app/pomodoro/actions', () => ({
  setPomodoroFocusMinutes: jest.fn(),
  setPomodoroBreakMinutes: jest.fn(),
  recordFocusSession: jest.fn(),
}));

import { setPomodoroBreakMinutes, setPomodoroFocusMinutes } from '../app/pomodoro/actions';
import { PRESET_FLUSH_MS, TimerRecorder } from '../app/pomodoro/timer-recorder';

const focusMock = setPomodoroFocusMinutes as jest.Mock;
const breakMock = setPomodoroBreakMinutes as jest.Mock;

/** The stored lengths a fresh mount starts from: the board's own defaults. */
const DURATIONS = { focus: 25, short: 5, long: 15 };

type RecorderTree = ReactElement<Record<string, unknown>>;

const ReactModule = jest.requireActual<typeof import('react')>('react');

/**
 * `TimerRecorder` runs the debounce hook three times — one settle window per length — plus its
 * own baseline ref. Outside React there is no dispatcher, so the two hooks it calls are spied:
 * `useRef` gets a position-keyed slot that survives re-renders, and `useEffect` records the
 * hook's cleanup so `unmount()` can run it.
 */
function mount() {
  const slots: Array<{ current: unknown }> = [];
  const cleanups: Array<() => void | (() => void)> = [];
  let nextSlot = 0;

  const refSpy = jest
    .spyOn(ReactModule, 'useRef')
    .mockImplementation(((initial: unknown) => {
      const slot = (slots[nextSlot++] ??= { current: initial });
      return slot;
    }) as unknown as typeof ReactModule.useRef);
  const effectSpy = jest
    .spyOn(ReactModule, 'useEffect')
    .mockImplementation(((fn: () => void | (() => void)) => {
      cleanups.push(fn);
    }) as unknown as typeof ReactModule.useEffect);

  return {
    render(): RecorderTree {
      nextSlot = 0;
      return TimerRecorder({ durations: DURATIONS }) as unknown as RecorderTree;
    },
    /** Run every captured effect cleanup, which is what an unmount does. */
    unmount: () => {
      for (const fn of cleanups.splice(0)) {
        const cleanup = fn();
        if (typeof cleanup === 'function') cleanup();
      }
    },
    restore: () => {
      refSpy.mockRestore();
      effectSpy.mockRestore();
    },
  };
}

/** The focus chip's reporter, as the page would call it. */
function pickFocus(page: RecorderTree): (minutes: number) => void {
  return page.props.onFocusLengthChange as (minutes: number) => void;
}

describe('TimerRecorder chip writes', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    focusMock.mockClear();
    breakMock.mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it('coalesces a burst of focus taps into one write carrying the final length', () => {
    const harness = mount();
    try {
      const report = pickFocus(harness.render());

      for (const minutes of [15, 50, 15, 50, 50]) report(minutes);

      // One tap per tap would have rewritten the cookie and revalidated the layout five times.
      expect(focusMock).not.toHaveBeenCalled();

      jest.advanceTimersByTime(PRESET_FLUSH_MS);

      expect(focusMock).toHaveBeenCalledTimes(1);
      expect(focusMock).toHaveBeenCalledWith(50);
    } finally {
      harness.restore();
    }
  });

  it('sends nothing when the burst comes back to the length the server already has', () => {
    const harness = mount();
    try {
      const report = pickFocus(harness.render());

      report(50);
      report(25);

      jest.advanceTimersByTime(PRESET_FLUSH_MS);

      // The server is already at 25; a rewrite plus a full revalidation would buy nothing.
      expect(focusMock).not.toHaveBeenCalled();
    } finally {
      harness.restore();
    }
  });

  it('settles a focus pick and a break pick independently, each with its own write', () => {
    const harness = mount();
    try {
      const page = harness.render();
      const pickBreak = page.props.onBreakLengthChange as (
        phase: 'short' | 'long',
        minutes: number,
      ) => void;

      pickFocus(page)(50);
      pickBreak('short', 10);

      jest.advanceTimersByTime(PRESET_FLUSH_MS);

      // One shared window would have let the break pick swallow the focus pick.
      expect(focusMock).toHaveBeenCalledTimes(1);
      expect(focusMock).toHaveBeenCalledWith(50);
      expect(breakMock).toHaveBeenCalledTimes(1);
      expect(breakMock).toHaveBeenCalledWith('short', 10);
    } finally {
      harness.restore();
    }
  });

  it('writes nothing while the settle window is still open', () => {
    const harness = mount();
    try {
      pickFocus(harness.render())(15);

      jest.advanceTimersByTime(PRESET_FLUSH_MS - 1);
      expect(focusMock).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(focusMock).toHaveBeenCalledWith(15);
    } finally {
      harness.restore();
    }
  });

  it('flushes a pending write when the card unmounts before the window closes', () => {
    const harness = mount();
    try {
      pickFocus(harness.render())(50);
      expect(focusMock).not.toHaveBeenCalled();

      harness.unmount();

      // The hook's documented contract: a pending write is flushed, never dropped.
      expect(focusMock).toHaveBeenCalledTimes(1);
      expect(focusMock).toHaveBeenCalledWith(50);
    } finally {
      harness.restore();
    }
  });
});
