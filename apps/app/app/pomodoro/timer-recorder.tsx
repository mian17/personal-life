'use client';

import { PomodoroPage, type Durations } from '@life/pomodoro';
import { useRef } from 'react';
import { useDebouncedCallback } from '@/lib/use-debounced-callback';
import { recordFocusSession, setPomodoroBreakMinutes, setPomodoroFocusMinutes } from './actions';

/**
 * How long a chip pick waits before it is written. Shorter than the toggle window
 * (`TOGGLE_DEBOUNCE_MS`) because the two wait for different things: a toggle is a state
 * flip the owner may still be exploring, while a chip is a length the page is already
 * previewing — the tap has chosen, and only the burst needs to settle before it persists.
 */
export const PRESET_FLUSH_MS = 250;

/** The three lengths a chip can pick, each with its own cookie on the server. */
type LengthKey = 'focus' | 'short' | 'long';

export interface TimerRecorderProps {
  durations: Durations;
  /** Minutes recorded today, counted by the page; passed straight through to the card. */
  todayMinutes?: number;
  /** Today's resolved goal, or `null` before the owner set one. */
  todayGoalMinutes?: number | null;
}

/**
 * The client mount: the page stays a display, this wrapper is what reaches the server action.
 *
 * The page is already optimistic — a chip sets the length in its own state, so the chip lights
 * up and the countdown previews the choice on the same tap. What is left to decide is the
 * write, and it is decided here rather than in `@life/pomodoro`: one tap per tap would fire a
 * server action that rewrites a cookie and revalidates the whole layout, so a burst of taps
 * would cost a revalidation each. The page keeps its plain `(minutes) => void` signature and
 * any host can pick its own write policy; this host settles the burst into one request.
 */
export function TimerRecorder({
  durations,
  todayMinutes,
  todayGoalMinutes,
}: Readonly<TimerRecorderProps>) {
  // What the server has been told, one baseline per length. A third of the point of the
  // baseline is the return trip: 25 → 50 → 25 leaves the server exactly where it already was,
  // so writing it would buy a cookie rewrite and a layout revalidation for no change at all.
  // ponytail: seeded once, from a copy — the ref is written to, so it must never alias the
  // prop the parent still owns. A preference changed elsewhere remounts this component, so
  // the prop only ever moves to a value one of these baselines already recorded; re-seed it
  // if a same-page settings write is ever added.
  const settled = useRef<Durations>({ ...durations });

  // One settle window per length, not one shared: the hook keeps a single pending action, so a
  // shared channel would let a break pick swallow a focus pick made a moment earlier. Three
  // lengths are three choices and owe three independent writes.
  const settleFocus = useDebouncedCallback(PRESET_FLUSH_MS);
  const settleShortBreak = useDebouncedCallback(PRESET_FLUSH_MS);
  const settleLongBreak = useDebouncedCallback(PRESET_FLUSH_MS);
  const flushLength: Record<LengthKey, (fn: () => void) => void> = {
    focus: settleFocus,
    short: settleShortBreak,
    long: settleLongBreak,
  };

  /** Report a picked length once the taps stop, carrying the value its row settled on. */
  function reportLength(length: LengthKey, minutes: number): void {
    flushLength[length](() => {
      if (settled.current[length] === minutes) return;

      // The baseline advances with the attempt, so the burst's own final value is the only
      // thing ever sent. A rejected write is left to the server action's own failure logging —
      // the page has no error surface for a cookie and the timer already runs on the choice —
      // and a later pick of a different value corrects the baseline.
      settled.current[length] = minutes;
      if (length === 'focus') void setPomodoroFocusMinutes(minutes);
      else void setPomodoroBreakMinutes(length, minutes);
    });
  }

  return (
    <PomodoroPage
      durations={durations}
      onFocusLengthChange={(minutes) => reportLength('focus', minutes)}
      onBreakLengthChange={(phase, minutes) => reportLength(phase, minutes)}
      // A finished block is a record of something that already happened, and it fires once,
      // so it goes straight through: delaying it would delay the day's total for no burst.
      onFocusBlockEnd={recordFocusSession}
      todayMinutes={todayMinutes}
      todayGoalMinutes={todayGoalMinutes}
    />
  );
}
